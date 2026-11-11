import json
import logging
import os
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

SYMBOL_PATTERN = re.compile(r"^[A-Z0-9^.=/-]{1,20}$")
WEEKS_BEFORE = 52
WEEKS_AFTER = 52
STOCK_NAMES = {
    "TSM": ("Taiwan Semiconductor", "NYSE"),
    "AAPL": ("Apple Inc.", "NASDAQ"),
    "AMZN": ("Amazon.com, Inc.", "NASDAQ"),
    "ARM": ("Arm Holdings plc", "NASDAQ"),
    "BABA": ("Alibaba Group Holding", "NYSE"),
    "BTC-USD": ("Bitcoin / US Dollar", "CRYPTO"),
    "GOOG": ("Alphabet Inc.", "NASDAQ"),
    "JPM": ("JPMorgan Chase & Co.", "NYSE"),
    "SOXX": ("iShares Semiconductor ETF", "NASDAQ"),
    "^IXIC": ("Nasdaq Composite", "NASDAQ"),
}

WATCHLIST_PATH = Path(__file__).parent.parent / "data" / "watchlist.json"

def load_watchlist() -> list[str]:
    """Load symbols from watchlist.json (first watchlist's tickets)."""
    try:
        with open(WATCHLIST_PATH, "r") as f:
            data = json.load(f)
        if data and isinstance(data, list) and len(data) > 0:
            tickets = data[0].get("tickets", [])
            return [t["symbol"] for t in tickets if "symbol" in t]
    except (FileNotFoundError, json.JSONDecodeError, KeyError, IndexError):
        pass
    # Fallback to defaults if file missing or corrupt
    return ["TSM", "AAPL", "AMZN", "ARM", "BABA", "BTC-USD", "GOOG", "JPM"]

def save_watchlist(symbols: list[str]) -> None:
    """Save symbols to watchlist.json, preserving structure."""
    try:
        with open(WATCHLIST_PATH, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = [{"watchlistName": "Watchlist 1", "tickets": []}]
    
    # Update first watchlist's tickets
    if data and isinstance(data, list) and len(data) > 0:
        existing_tickets = {t["symbol"]: t for t in data[0].get("tickets", [])}
        new_tickets = []
        for sym in symbols:
            if sym in existing_tickets:
                new_tickets.append(existing_tickets[sym])
            else:
                name, exchange = STOCK_NAMES.get(sym, (sym, "MARKET"))
                new_tickets.append({"symbol": sym, "ticketName": name, "exchange": exchange})
        data[0]["tickets"] = new_tickets
    
    with open(WATCHLIST_PATH, "w") as f:
        json.dump(data, f, indent=2)

def fetch_symbol_info(symbol: str) -> tuple[str, str]:
    """Fetch longName and exchange from yfinance. Falls back to STOCK_NAMES or defaults."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        name = info.get("longName") or info.get("shortName") or symbol
        exchange = info.get("fullExchangeName") or info.get("exchange") or "MARKET"
        # Normalize common exchange names
        if exchange == "NMS":
            exchange = "NASDAQ"
        elif exchange == "NYQ":
            exchange = "NYSE"
        return name, exchange
    except Exception:
        return STOCK_NAMES.get(symbol, (symbol, "MARKET"))

app = FastAPI(title="Stockroom API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
watchlist = load_watchlist()


class AddSymbol(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        symbol = value.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise ValueError("Use a valid ticker symbol.")
        return symbol


def _download(*, tickers: list[str] | str, **kwargs) -> pd.DataFrame:
    try:
        return yf.download(
            tickers=tickers,
            auto_adjust=True,
            progress=False,
            threads=False,
            **kwargs,
        )
    except Exception as exc:
        logger.exception("Yahoo Finance request failed for %s", tickers)
        raise HTTPException(
            status_code=502,
            detail="Market data provider request failed. Please try again.",
        ) from exc


def _frame_for(data: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if data.empty:
        return pd.DataFrame()
    if isinstance(data.columns, pd.MultiIndex):
        if ticker in data.columns.get_level_values(0):
            data = data[ticker]
        elif ticker in data.columns.get_level_values(1):
            data = data.xs(ticker, axis=1, level=1)
        else:
            return pd.DataFrame()
    required = ["Open", "High", "Low", "Close"]
    if not all(column in data.columns for column in required):
        return pd.DataFrame()
    columns = required + (["Volume"] if "Volume" in data.columns else [])
    return data[columns].dropna(subset=required).copy()


def _symbol_details(symbol: str) -> tuple[str, str]:
    return STOCK_NAMES.get(symbol, (symbol, "MARKET"))


def _price(value: object) -> float:
    return float(value)


def _latest_quote(data: pd.DataFrame, symbol: str) -> dict:
    frame = _frame_for(data, symbol)
    if len(frame) < 2:
        raise HTTPException(
            status_code=404, detail=f"No recent market data found for {symbol}."
        )
    previous = _price(frame["Close"].iloc[-2])
    current = _price(frame["Close"].iloc[-1])
    name, exchange = _symbol_details(symbol)
    return {
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "price": current,
        "change": current - previous,
        "change_percent": (current - previous) / previous * 100 if previous else 0.0,
    }


def history_payload(frame: pd.DataFrame, symbol: str, period: str) -> dict:
    frame = _frame_for(frame, symbol)
    if frame.empty:
        raise HTTPException(
            status_code=404, detail=f"No price history found for {symbol}."
        )

    close = frame["Close"]
    for span in (9, 21, 50, 200):
        frame[f"ema_{span}"] = close.ewm(span=span, adjust=False).mean()
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(
        span=26, adjust=False
    ).mean()
    frame["macd"] = macd
    frame["macd_signal"] = macd.ewm(span=9, adjust=False).mean()
    frame["macd_hist"] = frame["macd"] - frame["macd_signal"]

    delta = close.diff()
    average_gain = delta.clip(lower=0).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    average_loss = -delta.clip(upper=0).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    relative_strength = average_gain.div(average_loss.replace(0, float("nan")))
    frame["rsi_14"] = (
        (100 - 100 / (1 + relative_strength))
        .mask(average_loss.eq(0), 100.0)
        .mask(average_gain.eq(0) & average_loss.eq(0), 50.0)
    )
    candles = []
    for timestamp, row in frame.iterrows():
        candles.append(
            {
                "date": pd.Timestamp(timestamp).isoformat(),
                "open": _price(row["Open"]),
                "high": _price(row["High"]),
                "low": _price(row["Low"]),
                "close": _price(row["Close"]),
                "volume": None if "Volume" not in frame or pd.isna(row.get("Volume")) else _price(row["Volume"]),
                "ema_9": _price(row["ema_9"]),
                "ema_21": _price(row["ema_21"]),
                "ema_50": _price(row["ema_50"]),
                "ema_200": _price(row["ema_200"]),
                "macd": _price(row["macd"]),
                "macd_signal": _price(row["macd_signal"]),
                "macd_hist": _price(row["macd_hist"]),
                "rsi_14": None if pd.isna(row["rsi_14"]) else _price(row["rsi_14"]),
            }
        )
    return {"symbol": symbol, "range": period, "candles": candles}


def weekly_window(
    frame: pd.DataFrame, search_start: str | None = None, search_end: str | None = None
) -> tuple[dict, str]:
    if frame.empty:
        raise HTTPException(status_code=404, detail="No weekly price data was found.")
    search = frame
    if search_start:
        search = search.loc[search_start:]
    if search_end:
        search = search.loc[:search_end]
    if search.empty:
        raise HTTPException(status_code=404, detail="No peak data was found in the search range.")

    peak_date = search["High"].idxmax()
    peak_position = int(frame.index.get_indexer([peak_date])[0])
    low = max(0, peak_position - WEEKS_BEFORE)
    high = min(len(frame), peak_position + WEEKS_AFTER + 1)
    peak_high = _price(frame.loc[peak_date, "High"])
    candles = []
    for position, (timestamp, row) in enumerate(frame.iloc[low:high].iterrows()):
        values = {
            field.lower(): _price(row[field]) / peak_high * 100
            for field in ("Open", "High", "Low", "Close")
        }
        candles.append(
            {
                "week": low + position - peak_position,
                "date": pd.Timestamp(timestamp).date().isoformat(),
                **values,
            }
        )
    return (
        {
            "candles": candles,
            "peak_date": pd.Timestamp(peak_date).date().isoformat(),
            "peak_price": peak_high,
        },
        pd.Timestamp(peak_date).date().isoformat(),
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/watchlist")
def get_watchlist():
    data = _download(tickers=watchlist, period="5d", interval="1d", group_by="ticker")
    return {"quotes": [_latest_quote(data, symbol) for symbol in watchlist]}


@app.post("/api/watchlist", status_code=201)
def add_to_watchlist(request: AddSymbol):
    symbol = request.symbol
    if symbol in watchlist:
        raise HTTPException(status_code=409, detail=f"{symbol} is already on your watchlist.")
    data = _download(tickers=symbol, period="5d", interval="1d")
    quote = _latest_quote(data, symbol)
    watchlist.append(symbol)
    save_watchlist(watchlist)
    return {"quote": quote}


@app.post("/api/watchlist/add_symbol", status_code=201)
def add_symbol(request: AddSymbol):
    """Add symbol to watchlist, fetching name and exchange from yfinance."""
    symbol = request.symbol
    if symbol in watchlist:
        raise HTTPException(status_code=409, detail=f"{symbol} is already on your watchlist.")
    
    # Fetch name and exchange from yfinance
    name, exchange = fetch_symbol_info(symbol)
    
    # Verify symbol has valid market data
    data = _download(tickers=symbol, period="5d", interval="1d")
    _latest_quote(data, symbol)
    
    watchlist.append(symbol)
    
    # Save with fetched info
    try:
        with open(WATCHLIST_PATH, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = [{"watchlistName": "Watchlist 1", "tickets": []}]
    
    if data and isinstance(data, list) and len(data) > 0:
        existing_tickets = {t["symbol"]: t for t in data[0].get("tickets", [])}
        new_tickets = []
        for sym in watchlist:
            if sym in existing_tickets:
                new_tickets.append(existing_tickets[sym])
            else:
                n, ex = fetch_symbol_info(sym)
                new_tickets.append({"symbol": sym, "ticketName": n, "exchange": ex})
        data[0]["tickets"] = new_tickets
    
    with open(WATCHLIST_PATH, "w") as f:
        json.dump(data, f, indent=2)
    
    return {"symbol": symbol, "name": name, "exchange": exchange}


@app.delete("/api/watchlist")
def remove_from_watchlist(symbol: str = Query(min_length=1, max_length=20)):
    symbol = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise HTTPException(status_code=422, detail="Use a valid ticker symbol.")
    if symbol not in watchlist:
        raise HTTPException(status_code=404, detail=f"{symbol} is not on your watchlist.")
    watchlist.remove(symbol)
    save_watchlist(watchlist)
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
