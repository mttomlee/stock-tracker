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
    get_watchlist as _get_watchlist,
    load_watchlist,
    persist_watchlist,
    set_watchlist as _set_watchlist,
)

WATCHLIST_PATH = Path(__file__).parent.parent / "data" / "watchlist.json"


def _persist_watchlist(
    symbols: list[str], resolve_info: Callable[[str], tuple[str, str]] | None = None
) -> None:
    """Persist watchlist symbols to JSON file with thread safety."""
    persist_watchlist(symbols, WATCHLIST_PATH, resolve_info)


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
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


# Initialize watchlist on startup
_set_watchlist(load_watchlist(WATCHLIST_PATH))


class AddSymbol(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise ValueError("Use a valid ticker symbol.")
        return symbol


def _require_csrf(request: Request) -> None:
    """Require X-Requested-With header for mutating endpoints (CSRF protection)."""
    if request.headers.get("X-Requested-With") != "XMLHttpRequest":
        raise HTTPException(status_code=403, detail="CSRF protection: missing required header")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/watchlist")
def get_watchlist():
    watchlist = _get_watchlist()
    data = _download(tickers=watchlist, period="5d", interval="1d", group_by="ticker")
    return {"quotes": [_latest_quote(data, symbol) for symbol in watchlist]}


@app.post("/api/watchlist", status_code=201)
def add_to_watchlist(request: AddSymbol, req: Request):
    """Legacy endpoint — delegates to add_symbol for consistent behavior."""
    _require_csrf(req)
    return add_symbol(request, req)


@app.post("/api/watchlist/add_symbol", status_code=201)
def add_symbol(request: AddSymbol, req: Request):
    """Add symbol to watchlist, fetching name and exchange from yfinance."""
    _require_csrf(req)
    symbol = request.symbol
    watchlist = _get_watchlist()
    if symbol in watchlist:
        raise HTTPException(status_code=409, detail=f"{symbol} is already on your watchlist.")

    # Fetch name and exchange from yfinance
    name, exchange = fetch_symbol_info(symbol)

    # Verify symbol has valid market data and compute the latest quote
    data = _download(tickers=symbol, period="5d", interval="1d")
    quote = _latest_quote(data, symbol)
    quote["name"] = name
    quote["exchange"] = exchange

    watchlist.append(symbol)
    _set_watchlist(watchlist)

    # Save with fetched info
    _persist_watchlist(watchlist, fetch_symbol_info)

    return {"quote": quote}


@app.delete("/api/watchlist")
def remove_from_watchlist(symbol: str = Query(min_length=1, max_length=20), req: Request = None):
    if req:
        _require_csrf(req)
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise HTTPException(status_code=422, detail="Use a valid ticker symbol.")
    watchlist = _get_watchlist()
    if symbol not in watchlist:
        raise HTTPException(status_code=404, detail=f"{symbol} is not on your watchlist.")
    watchlist.remove(symbol)
    _set_watchlist(watchlist)
    _persist_watchlist(watchlist)
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
