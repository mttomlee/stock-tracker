import logging

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from backend.symbols import symbol_details

logger = logging.getLogger(__name__)

WEEKS_BEFORE = 52
WEEKS_AFTER = 52

# Indicators are seeded before the visible window; the seed's weight decays as
# (1 - alpha) ** bars, so ~10 years of daily bars converge EMA-200.
WARMUP_DAYS = 3650


def fetch_symbol_info(symbol: str) -> tuple[str, str]:
    """Fetch longName and exchange from yfinance. Falls back to defaults on error."""
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
    except (KeyError, ValueError, ConnectionError, TimeoutError) as exc:
        logger.warning("Failed to fetch symbol info for %s: %s", symbol, exc)
        return symbol, "MARKET"


def download_frame(*, tickers: list[str] | str, **kwargs) -> pd.DataFrame:
    try:
        return yf.download(
            tickers=tickers,
            auto_adjust=True,
            progress=False,
            threads=False,
            timeout=15,  # 15 second timeout for Yahoo Finance calls
            **kwargs,
        )
    except Exception as exc:
        logger.exception("Yahoo Finance request failed for %s", tickers)
        raise HTTPException(
            status_code=502,
            detail="Market data provider request failed. Please try again.",
        ) from exc


def frame_for(data: pd.DataFrame, ticker: str) -> pd.DataFrame:
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


def latest_quote(data: pd.DataFrame, symbol: str) -> dict:
    frame = frame_for(data, symbol)
    if frame.empty:
        raise HTTPException(
            status_code=404, detail=f"No recent market data found for {symbol}."
        )
    # Allow 1 data point (new/thin symbols) — change is 0 in that case
    if len(frame) >= 2:
        previous = float(frame["Close"].iloc[-2])
        current = float(frame["Close"].iloc[-1])
        change = current - previous
        change_percent = (current - previous) / previous * 100 if previous else 0.0
    else:
        # Only one data point available
        current = float(frame["Close"].iloc[-1])
        change = 0.0
        change_percent = 0.0
    name, exchange = symbol_details(symbol)
    return {
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "price": current,
        "change": change,
        "change_percent": change_percent,
    }


def _add_indicators(frame: pd.DataFrame) -> None:
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
    average_gain = (
        delta.clip(lower=0).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    )
    average_loss = (
        -delta.clip(upper=0).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    )
    relative_strength = average_gain.div(average_loss.replace(0, float("nan")))
    frame["rsi_14"] = (
        (100 - 100 / (1 + relative_strength))
        .mask(average_loss.eq(0), 100.0)
        .mask(average_gain.eq(0) & average_loss.eq(0), 50.0)
    )


def _visible_frame(frame: pd.DataFrame, chart_range: str) -> pd.DataFrame:
    """Trailing rows the chart shows for a preset range."""
    index = frame.index
    if chart_range == "1D":
        return frame.loc[index[-1].normalize():]
    if chart_range == "1W":
        dates = index.normalize().unique()
        return frame.loc[dates[max(0, len(dates) - 5)]:]
    if chart_range == "1M":
        return frame.loc[index[-1] - pd.DateOffset(months=1):]
    return frame.loc[index[-1] - pd.DateOffset(years=1):]


def history_payload(
    frame: pd.DataFrame,
    symbol: str,
    period: str,
    *,
    chart_range: str | None = None,
    visible_from: pd.Timestamp | None = None,
) -> dict:
    """Indicators are computed on the whole downloaded frame (the warm-up
    before the visible window), then the frame is sliced to what the chart shows."""
    frame = frame_for(frame, symbol)
    if not frame.empty:
        _add_indicators(frame)
        if visible_from is not None:
            tz = getattr(frame.index, "tz", None)
            since = visible_from.tz_localize(tz) if tz else visible_from
            frame = frame.loc[since:]
        elif chart_range:
            frame = _visible_frame(frame, chart_range)
    if frame.empty:
        raise HTTPException(
            status_code=404, detail=f"No price history found for {symbol}."
        )

    candles = []
    for timestamp, row in frame.iterrows():
        candles.append(
            {
                "date": pd.Timestamp(timestamp).isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": (
                    None
                    if "Volume" not in frame or pd.isna(row.get("Volume"))
                    else float(row["Volume"])
                ),
                "ema_9": float(row["ema_9"]),
                "ema_21": float(row["ema_21"]),
                "ema_50": float(row["ema_50"]),
                "ema_200": float(row["ema_200"]),
                "macd": float(row["macd"]),
                "macd_signal": float(row["macd_signal"]),
                "macd_hist": float(row["macd_hist"]),
                "rsi_14": None if pd.isna(row["rsi_14"]) else float(row["rsi_14"]),
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
    peak_high = float(frame.loc[peak_date, "High"])
    candles = []
    for position, (timestamp, row) in enumerate(frame.iloc[low:high].iterrows()):
        values = {
            field.lower(): float(row[field]) / peak_high * 100
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
