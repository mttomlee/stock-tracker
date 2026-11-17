from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from backend.market_data import (
    download_frame as _download,
    fetch_symbol_info,
    frame_for as _frame_for,
    history_payload,
    latest_quote as _latest_quote,
    weekly_window,
)
from backend.symbols import SYMBOL_PATTERN
from backend.watchlist_store import (
    get_watchlist as _store_get_watchlist,
    get_watchlists as _store_get_watchlists,
    load_watchlists,
    persist_watchlists as _store_persist_watchlists,
    set_ticket_info as _set_ticket_info,
    set_watchlist as _store_set_watchlist,
    set_watchlists as _store_set_watchlists,
    watchlists_lock as _watchlists_lock,
)

WATCHLIST_PATH = Path(__file__).parent.parent / "data" / "watchlist.json"


def _get_watchlist(name: str | None = None) -> list[str] | None:
    """Symbols for the named watchlist (first when omitted)."""
    return _store_get_watchlist(name)


def _set_watchlist(symbols: list[str], name: str | None = None) -> None:
    """Replace one watchlist's symbols (first when name is omitted)."""
    _store_set_watchlist(symbols, name)


def _get_watchlists() -> list[dict]:
    """All named watchlists."""
    return _store_get_watchlists()


def _set_watchlists(watchlists: list[dict]) -> None:
    """Replace all named watchlists."""
    _store_set_watchlists(watchlists)


def _persist_watchlists(
    watchlists: list[dict],
    resolve_info: Callable[[str], tuple[str, str]] | None = None,
) -> None:
    """Persist all named watchlists to JSON."""
    _store_persist_watchlists(watchlists, WATCHLIST_PATH, resolve_info)


def _persist_watchlist(
    symbols: list[str],
    resolve_info: Callable[[str], tuple[str, str]] | None = None,
    name: str | None = None,
) -> None:
    """Persist one watchlist's symbols to JSON (first when name is omitted)."""
    watchlists = _get_watchlists() or [{"watchlistName": "Watchlist 1", "tickets": []}]
    target = watchlists[0] if name is None else _find_watchlist(watchlists, name)
    if target is None:
        return
    existing = {ticket["symbol"]: ticket for ticket in target["tickets"]}
    target["tickets"] = [existing.get(symbol, {"symbol": symbol}) for symbol in symbols]
    _persist_watchlists(watchlists, resolve_info)


app = FastAPI(title="Stockroom API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


# Initialize watchlists on startup
_set_watchlists(load_watchlists(WATCHLIST_PATH))


class AddSymbol(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    watchlist: str | None = None

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise ValueError("Use a valid ticker symbol.")
        return symbol


class WatchlistName(BaseModel):
    name: str


def _clean_name(raw: str) -> str:
    name = raw.strip()
    if not 1 <= len(name) <= 40:
        raise HTTPException(
            status_code=422, detail="Watchlist name must be 1-40 characters."
        )
    return name


def _find_watchlist(watchlists: list[dict], name: str) -> dict | None:
    key = name.strip().casefold()
    return next(
        (w for w in watchlists if w["watchlistName"].casefold() == key), None
    )


def _require_csrf(request: Request) -> None:
    """Require X-Requested-With header for mutating endpoints (CSRF protection)."""
    if request.headers.get("X-Requested-With") != "XMLHttpRequest":
        raise HTTPException(status_code=403, detail="CSRF protection: missing required header")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/watchlists")
def list_watchlists():
    return {
        "watchlists": [
            {"name": watchlist["watchlistName"], "count": len(watchlist["tickets"])}
            for watchlist in _get_watchlists()
        ]
    }


@app.post("/api/watchlists", status_code=201)
def create_watchlist(request: WatchlistName, req: Request):
    _require_csrf(req)
    name = _clean_name(request.name)
    with _watchlists_lock():
        watchlists = _get_watchlists()
        if _find_watchlist(watchlists, name):
            raise HTTPException(status_code=409, detail=f"Watchlist '{name}' already exists.")
        watchlists.append({"watchlistName": name, "tickets": []})
        _set_watchlists(watchlists)
        _persist_watchlists(watchlists)
    return {"name": name, "count": 0}


@app.patch("/api/watchlists/{name:path}")
def rename_watchlist(name: str, request: WatchlistName, req: Request):
    _require_csrf(req)
    new_name = _clean_name(request.name)
    with _watchlists_lock():
        watchlists = _get_watchlists()
        target = _find_watchlist(watchlists, name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Watchlist '{name}' not found.")
        duplicate = _find_watchlist(watchlists, new_name)
        if duplicate is not None and duplicate is not target:
            raise HTTPException(
                status_code=409, detail=f"Watchlist '{new_name}' already exists."
            )
        target["watchlistName"] = new_name
        _set_watchlists(watchlists)
        _persist_watchlists(watchlists)
        count = len(target["tickets"])
    return {"name": new_name, "count": count}


@app.delete("/api/watchlists/{name:path}")
def delete_watchlist(name: str, req: Request):
    _require_csrf(req)
    with _watchlists_lock():
        watchlists = _get_watchlists()
        target = _find_watchlist(watchlists, name)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Watchlist '{name}' not found.")
        if len(watchlists) == 1:
            raise HTTPException(
                status_code=409, detail="Cannot delete the last watchlist."
            )
        watchlists.remove(target)
        _set_watchlists(watchlists)
        _persist_watchlists(watchlists)
        deleted = target["watchlistName"]
    return {"deleted": deleted}


@app.get("/api/watchlist")
def get_watchlist(watchlist: str | None = None):
    watchlist_symbols = _get_watchlist(watchlist)
    if watchlist_symbols is None:
        raise HTTPException(status_code=404, detail=f"Watchlist '{watchlist}' not found.")
    if not watchlist_symbols:
        return {"quotes": []}
    data = _download(
        tickers=watchlist_symbols, period="5d", interval="1d", group_by="ticker"
    )
    return {"quotes": [_latest_quote(data, symbol) for symbol in watchlist_symbols]}


@app.post("/api/watchlist", status_code=201)
def add_to_watchlist(request: AddSymbol, req: Request):
    """Legacy endpoint — delegates to add_symbol for consistent behavior."""
    _require_csrf(req)
    return add_symbol(request, req)


@app.post("/api/watchlist/add_symbol", status_code=201)
def add_symbol(request: AddSymbol, req: Request):
    """Add symbol to a watchlist, fetching name and exchange from yfinance."""
    _require_csrf(req)
    symbol = request.symbol
    watchlist_name = request.watchlist
    watchlist = _get_watchlist(watchlist_name)
    if watchlist is None:
        raise HTTPException(
            status_code=404, detail=f"Watchlist '{watchlist_name}' not found."
        )
    if symbol in watchlist:
        raise HTTPException(status_code=409, detail=f"{symbol} is already on your watchlist.")

    # Fetch name and exchange from yfinance outside the lock (slow network calls).
    name, exchange = fetch_symbol_info(symbol)
    data = _download(tickers=symbol, period="5d", interval="1d")
    quote = _latest_quote(data, symbol)
    quote["name"] = name
    quote["exchange"] = exchange

    with _watchlists_lock():
        # Re-check under the lock: another request may have changed the list.
        watchlist = _get_watchlist(watchlist_name)
        if watchlist is None:
            raise HTTPException(
                status_code=404, detail=f"Watchlist '{watchlist_name}' not found."
            )
        if symbol in watchlist:
            raise HTTPException(
                status_code=409, detail=f"{symbol} is already on your watchlist."
            )
        watchlist.append(symbol)
        if watchlist_name is None:
            _set_watchlist(watchlist)
        else:
            _set_watchlist(watchlist, watchlist_name)
        _set_ticket_info(symbol, name, exchange, watchlist_name)

        # Save with fetched info; reuse the info already fetched for this symbol.
        known = {symbol: (name, exchange)}
        _persist_watchlist(
            watchlist,
            lambda ticker: known.get(ticker) or fetch_symbol_info(ticker),
            name=watchlist_name,
        )

    return {"quote": quote}


@app.delete("/api/watchlist")
def remove_from_watchlist(
    symbol: str = Query(min_length=1, max_length=20),
    req: Request = None,
    watchlist: str | None = None,
):
    _require_csrf(req)
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise HTTPException(status_code=422, detail="Use a valid ticker symbol.")
    with _watchlists_lock():
        symbols = _get_watchlist(watchlist)
        if symbols is None:
            raise HTTPException(status_code=404, detail=f"Watchlist '{watchlist}' not found.")
        if symbol not in symbols:
            raise HTTPException(status_code=404, detail=f"{symbol} is not on your watchlist.")
        symbols.remove(symbol)
        if watchlist is None:
            _set_watchlist(symbols)
            _persist_watchlist(symbols)
        else:
            _set_watchlist(symbols, watchlist)
            _persist_watchlist(symbols, name=watchlist)
    return {"removed": symbol}


@app.get("/api/stocks/history")
def get_stock_history(
    symbol: str = Query(min_length=1, max_length=20),
    chart_range: Literal["1D", "1W", "1M", "1Y"] = Query(default="1W", alias="range"),
    start_date: date | None = Query(default=None, alias="start"),
    end_date: date | None = Query(default=None, alias="end"),
):
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise HTTPException(status_code=422, detail="Use a valid ticker symbol.")
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail="Provide both start and end dates.")
    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(
                status_code=422, detail="Start date must be on or before end date."
            )
        data = _download(
            tickers=symbol,
            start=start_date,
            end=end_date + timedelta(days=1),
            interval="1d",
        )
        return history_payload(
            data, symbol, f"{start_date.isoformat()} - {end_date.isoformat()}"
        )

    period_settings = {
        "1D": ("1d", "5m"),
        "1W": ("5d", "30m"),
        "1M": ("1mo", "1d"),
        "1Y": ("1y", "1wk"),
    }
    yahoo_period, interval = period_settings[chart_range]
    data = _download(tickers=symbol, period=yahoo_period, interval=interval)
    return history_payload(data, symbol, chart_range)


@app.get("/api/comparison/soxx-dotcom")
def compare_semiconductor_cycle():
    today = pd.Timestamp(date.today())
    recent_peak_start = (today - pd.DateOffset(years=2)).date().isoformat()
    soxx_data = _frame_for(
        _download(tickers="SOXX", start="2023-01-01", interval="1wk"), "SOXX"
    )
    nasdaq_data = _frame_for(
        _download(tickers="^IXIC", start="1998-01-01", end="2001-12-31", interval="1wk"),
        "^IXIC",
    )
    soxx, _ = weekly_window(soxx_data, recent_peak_start)
    nasdaq, _ = weekly_window(nasdaq_data, "1999-01-01", "2000-12-31")
    return {
        "series": [
            {"name": "SOXX", **soxx},
            {"name": "Nasdaq Composite", **nasdaq},
        ]
    }
