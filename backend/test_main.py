import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException

from backend.main import (
    AddSymbol,
    _latest_quote,
    _persist_watchlist,
    add_symbol,
    fetch_symbol_info,
    get_stock_history,
    history_payload,
    remove_from_watchlist,
    weekly_window,
)


class MarketDataTests(unittest.TestCase):
    def test_custom_history_range_includes_end_date(self):
        frame = pd.DataFrame(
            {
                "Open": [10.0],
                "High": [12.0],
                "Low": [9.0],
                "Close": [11.0],
                "Volume": [1000],
            },
            index=pd.date_range("2025-01-01", periods=1),
        )
        with (
            patch("backend.main._get_watchlist", return_value=["TSM"]),
            patch("backend.main._download", return_value=frame) as download,
        ):
            payload = get_stock_history(
                "TSM", start_date=date(2025, 1, 1), end_date=date(2025, 1, 3)
            )

        download.assert_called_once_with(
            tickers="TSM",
            start=date(2025, 1, 1),
            end=date(2025, 1, 4),
            interval="1d",
        )
        self.assertEqual(payload["range"], "2025-01-01 - 2025-01-03")

    def test_custom_history_range_requires_ordered_date_pair(self):
        with self.assertRaises(HTTPException) as error:
            get_stock_history(
                "TSM", start_date=date(2025, 1, 3), end_date=None
            )
        self.assertEqual(error.exception.status_code, 422)

        with self.assertRaises(HTTPException) as error:
            get_stock_history(
                "TSM", start_date=date(2025, 1, 3), end_date=date(2025, 1, 1)
            )
        self.assertEqual(error.exception.status_code, 422)

    def test_history_payload_calculates_moving_averages(self):
        dates = pd.date_range("2025-01-01", periods=220, freq="D")
        close = pd.Series(range(100, 320), index=dates, dtype=float)
        frame = pd.DataFrame(
            {
                "Open": close - 0.5,
                "High": close + 1,
                "Low": close - 1,
                "Close": close,
                "Volume": range(1000, 1220),
            }
        )

        payload = history_payload(frame, "TEST", "1Y")

        self.assertEqual(len(payload["candles"]), 220)
        self.assertGreater(payload["candles"][-1]["ema_200"], 100)
        self.assertEqual(payload["candles"][-1]["close"], 319.0)
        self.assertEqual(payload["candles"][-1]["volume"], 1219.0)
        self.assertGreater(payload["candles"][-1]["macd"], 0)
        self.assertEqual(payload["candles"][-1]["rsi_14"], 100.0)

    def test_weekly_window_rebases_peak_and_aligns_week_zero(self):
        dates = pd.date_range("2000-01-07", periods=5, freq="W-FRI")
        frame = pd.DataFrame(
            {
                "Open": [8, 9, 10, 9, 8],
                "High": [9, 10, 12, 10, 9],
                "Low": [7, 8, 9, 8, 7],
                "Close": [8, 9, 11, 9, 8],
            },
            index=dates,
        )

        payload, peak_date = weekly_window(frame)

        peak = next(candle for candle in payload["candles"] if candle["week"] == 0)
        self.assertEqual(peak_date, "2000-01-21")
        self.assertEqual(peak["high"], 100.0)
        self.assertEqual(payload["candles"][0]["week"], -2)
        self.assertEqual(payload["candles"][-1]["week"], 2)

    def test_weekly_window_reports_empty_peak_range(self):
        dates = pd.date_range("2020-01-03", periods=2, freq="W-FRI")
        frame = pd.DataFrame(
            {"Open": [1, 2], "High": [2, 3], "Low": [1, 2], "Close": [2, 3]},
            index=dates,
        )

        with self.assertRaises(HTTPException) as error:
            weekly_window(frame, "2021-01-01")

        self.assertEqual(error.exception.status_code, 404)


class WatchlistAddTests(unittest.TestCase):
    def test_add_symbol_returns_quote_with_current_price(self):
        frame = pd.DataFrame(
            {
                "Open": [100.0, 101.0],
                "High": [102.0, 103.0],
                "Low": [99.0, 100.0],
                "Close": [100.0, 101.0],
                "Volume": [1000, 1100],
            },
            index=pd.date_range("2025-01-01", periods=2),
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            mock_req = MagicMock()
            mock_req.headers.get.return_value = "XMLHttpRequest"

            with (
                patch("backend.main._get_watchlist", return_value=["TSM"]),
                patch("backend.main._download", return_value=frame),
                patch("backend.main.fetch_symbol_info", return_value=("New Co", "NASDAQ")),
                patch("backend.main._set_watchlist"),
                patch("backend.main.WATCHLIST_PATH", Path(tmp_path)),
            ):
                result = add_symbol(AddSymbol(symbol="NEW"), mock_req)
        finally:
            os.unlink(tmp_path)

        self.assertEqual(
            result,
            {
                "quote": {
                    "symbol": "NEW",
                    "name": "New Co",
                    "exchange": "NASDAQ",
                    "price": 101.0,
                    "change": 1.0,
                    "change_percent": 1.0,
                }
            },
        )


class RegressionTests(unittest.TestCase):
    """Regression tests for thread-safe watchlist and error handling."""

    def test_csrf_protection_rejects_missing_header(self):
        """CSRF protection requires X-Requested-With header on mutating endpoints."""
        mock_req = MagicMock()
        mock_req.headers.get.return_value = None  # Missing header

        with self.assertRaises(HTTPException) as error:
            add_symbol(AddSymbol(symbol="NEW"), mock_req)

        self.assertEqual(error.exception.status_code, 403)
        self.assertIn("CSRF", error.exception.detail)

    def test_csrf_protection_accepts_xmlhttprequest_header(self):
        """CSRF protection accepts X-Requested-With: XMLHttpRequest."""
        frame = pd.DataFrame(
            {
                "Open": [100.0, 101.0],
                "High": [102.0, 103.0],
                "Low": [99.0, 100.0],
                "Close": [100.0, 101.0],
                "Volume": [1000, 1100],
            },
            index=pd.date_range("2025-01-01", periods=2),
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            mock_req = MagicMock()
            mock_req.headers.get.return_value = "XMLHttpRequest"

            with (
                patch("backend.main._get_watchlist", return_value=["TSM"]),
                patch("backend.main._download", return_value=frame),
                patch("backend.main.fetch_symbol_info", return_value=("New Co", "NASDAQ")),
                patch("backend.main._set_watchlist"),
                patch("backend.main.WATCHLIST_PATH", Path(tmp_path)),
            ):
                result = add_symbol(AddSymbol(symbol="NEW"), mock_req)

            self.assertIn("quote", result)
            self.assertEqual(result["quote"]["symbol"], "NEW")
        finally:
            os.unlink(tmp_path)

    def test_fetch_symbol_info_exception_handling(self):
        """fetch_symbol_info falls back gracefully on yfinance errors."""
        with patch("backend.main.yf.Ticker") as mock_ticker:
            mock_ticker.return_value.info = {}
            mock_ticker.side_effect = ConnectionError("network down")

            name, exchange = fetch_symbol_info("NEW")

            self.assertEqual(name, "NEW")
            self.assertEqual(exchange, "MARKET")

    def test_latest_quote_single_data_point(self):
        """_latest_quote handles single data point (new/thin symbols)."""
        frame = pd.DataFrame(
            {
                "Open": [100.0],
                "High": [102.0],
                "Low": [99.0],
                "Close": [101.0],
                "Volume": [1000],
            },
            index=pd.date_range("2025-01-01", periods=1),
        )

        quote = _latest_quote(frame, "NEW")

        self.assertEqual(quote["price"], 101.0)
        self.assertEqual(quote["change"], 0.0)
        self.assertEqual(quote["change_percent"], 0.0)

    def test_latest_quote_multiple_data_points(self):
        """_latest_quote computes change correctly with multiple data points."""
        frame = pd.DataFrame(
            {
                "Open": [100.0, 101.0],
                "High": [102.0, 103.0],
                "Low": [99.0, 100.0],
                "Close": [100.0, 101.0],
                "Volume": [1000, 1100],
            },
            index=pd.date_range("2025-01-01", periods=2),
        )

        quote = _latest_quote(frame, "NEW")

        self.assertEqual(quote["price"], 101.0)
        self.assertEqual(quote["change"], 1.0)
        self.assertAlmostEqual(quote["change_percent"], 1.0)

    def test_thread_safe_watchlist_access(self):
        """_get_watchlist and _set_watchlist are thread-safe."""
        from backend.main import _get_watchlist, _set_watchlist, _watchlist_lock
        import threading
        import time

        results = []
        errors = []

        def writer(symbols):
            try:
                _set_watchlist(symbols)
                time.sleep(0.001)
                results.append(_get_watchlist())
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(["AAPL", "GOOG"],)) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        # All reads should return consistent state
        for result in results:
            self.assertEqual(result, ["AAPL", "GOOG"])

    def test_persist_watchlist_creates_file_and_directory(self):
        """_persist_watchlist creates parent directory and file if missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            watchlist_path = Path(tmpdir) / "data" / "watchlist.json"

            with patch("backend.main.WATCHLIST_PATH", watchlist_path):
                _persist_watchlist(["AAPL", "TSM"])

            self.assertTrue(watchlist_path.exists())
            with open(watchlist_path) as f:
                data = json.load(f)

            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["watchlistName"], "Watchlist 1")
            self.assertEqual(len(data[0]["tickets"]), 2)
            self.assertEqual(data[0]["tickets"][0]["symbol"], "AAPL")
            self.assertEqual(data[0]["tickets"][1]["symbol"], "TSM")

    def test_remove_from_watchlist_requires_csrf(self):
        """remove_from_watchlist requires CSRF header."""
        mock_req = MagicMock()
        mock_req.headers.get.return_value = None

        with patch("backend.main._get_watchlist", return_value=["AAPL"]):
            with self.assertRaises(HTTPException) as error:
                remove_from_watchlist("AAPL", mock_req)

        self.assertEqual(error.exception.status_code, 403)

    def test_remove_from_watchlist_with_csrf(self):
        """remove_from_watchlist works with valid CSRF header."""
        mock_req = MagicMock()
        mock_req.headers.get.return_value = "XMLHttpRequest"

        with (
            patch("backend.main._get_watchlist", return_value=["AAPL", "TSM"]),
            patch("backend.main._set_watchlist") as mock_set,
            patch("backend.main._persist_watchlist") as mock_persist,
        ):
            result = remove_from_watchlist("AAPL", mock_req)

        self.assertEqual(result, {"removed": "AAPL"})
        mock_set.assert_called_once_with(["TSM"])
        mock_persist.assert_called_once_with(["TSM"])


if __name__ == "__main__":
    unittest.main()