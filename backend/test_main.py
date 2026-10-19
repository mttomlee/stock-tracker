import unittest

import pandas as pd
from fastapi import HTTPException

from backend.main import history_payload, weekly_window


class MarketDataTests(unittest.TestCase):
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
