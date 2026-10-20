import unittest
from datetime import date
from unittest.mock import patch

import pandas as pd
from fastapi import HTTPException

from backend.main import get_stock_history, history_payload, weekly_window


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
            patch("backend.main.watchlist", ["TSM"]),
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


if __name__ == "__main__":
    unittest.main()
