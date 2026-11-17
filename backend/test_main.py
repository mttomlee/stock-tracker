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
    WatchlistName,
    _latest_quote,
    _persist_watchlist,
    add_symbol,
    add_to_watchlist,
    create_watchlist,
    delete_watchlist,
    fetch_symbol_info,
    get_stock_history,
    get_watchlist as get_watchlist_quotes,
    history_payload,
    list_watchlists,
    remove_from_watchlist,
    rename_watchlist,
    weekly_window,
)
from backend.symbols import DEFAULT_WATCHLIST
from backend.watchlist_store import (
    get_watchlist,
    get_watchlists,
    load_watchlist,
    load_watchlists,
    persist_watchlist,
    persist_watchlists,
    set_ticket_info,
    set_watchlist,
    set_watchlists,
)


def _watchlists_fixture():
    return [
        {
            "watchlistName": "Watchlist 1",
            "tickets": [
                {"symbol": "TSM", "ticketName": "Taiwan Semiconductor", "exchange": "NYSE"}
            ],
        },
        {
            "watchlistName": "Growth",
            "tickets": [
                {"symbol": "AAPL", "ticketName": "Apple Inc.", "exchange": "NASDAQ"}
            ],
        },
    ]


def _quote_frame():
    return pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [102.0, 103.0],
            "Low": [99.0, 100.0],
            "Close": [100.0, 101.0],
            "Volume": [1000, 1100],
        },
        index=pd.date_range("2025-01-01", periods=2),
    )


def _csrf_request():
    req = MagicMock()
    req.headers.get.return_value = "XMLHttpRequest"
    return req


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
        with patch("backend.market_data.yf.Ticker") as mock_ticker:
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
        from backend.main import _get_watchlist, _set_watchlist
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


class WatchlistStoreTests(unittest.TestCase):
    """Store-level tests for multiple named watchlists."""

    def setUp(self):
        self._saved = get_watchlists()

    def tearDown(self):
        set_watchlists(self._saved)

    def test_load_watchlists_reads_every_list(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "watchlist.json"
            path.write_text(json.dumps(_watchlists_fixture()))

            lists = load_watchlists(path)

            self.assertEqual(load_watchlist(path, "Growth"), ["AAPL"])
            self.assertEqual(load_watchlist(path), ["TSM"])

        self.assertEqual([w["watchlistName"] for w in lists], ["Watchlist 1", "Growth"])
        self.assertEqual([t["symbol"] for t in lists[1]["tickets"]], ["AAPL"])

    def test_load_watchlists_seeds_default_when_missing_corrupt_or_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "watchlist.json"

            for contents in (None, "not json", "[]"):
                if contents is not None:
                    path.write_text(contents)
                lists = load_watchlists(path)

                self.assertEqual(len(lists), 1)
                self.assertEqual(lists[0]["watchlistName"], "Watchlist 1")
                self.assertEqual(
                    [t["symbol"] for t in lists[0]["tickets"]], DEFAULT_WATCHLIST
                )

    def test_load_watchlists_tolerates_null_tickets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "watchlist.json"
            path.write_text(json.dumps([{"watchlistName": "A", "tickets": None}]))

            lists = load_watchlists(path)

        self.assertEqual(lists, [{"watchlistName": "A", "tickets": []}])

    def test_set_ticket_info_updates_in_memory_ticket(self):
        set_watchlists(_watchlists_fixture())

        set_ticket_info("AAPL", "Apple Inc. (updated)", "NASDAQ", "Growth")

        ticket = get_watchlists()[1]["tickets"][0]
        self.assertEqual(ticket["ticketName"], "Apple Inc. (updated)")
        self.assertEqual(ticket["exchange"], "NASDAQ")

    def test_set_watchlist_scopes_to_named_list_and_keeps_ticket_info(self):
        set_watchlists(_watchlists_fixture())

        set_watchlist(["AAPL", "MSFT"], "growth")

        lists = get_watchlists()
        self.assertEqual([t["symbol"] for t in lists[0]["tickets"]], ["TSM"])
        self.assertEqual([t["symbol"] for t in lists[1]["tickets"]], ["AAPL", "MSFT"])
        self.assertEqual(lists[1]["tickets"][0]["ticketName"], "Apple Inc.")
        self.assertEqual(get_watchlist("GROWTH"), ["AAPL", "MSFT"])
        self.assertIsNone(get_watchlist("Unknown"))

    def test_persist_watchlists_round_trips_all_lists_and_fills_ticket_info(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "data" / "watchlist.json"
            watchlists = _watchlists_fixture()
            watchlists.append(
                {"watchlistName": "New", "tickets": [{"symbol": "ZZZ"}]}
            )

            persist_watchlists(watchlists, path)
            data = json.loads(path.read_text())

        self.assertEqual(
            [w["watchlistName"] for w in data], ["Watchlist 1", "Growth", "New"]
        )
        self.assertEqual(
            data[0]["tickets"][0]["ticketName"], "Taiwan Semiconductor"
        )
        self.assertEqual(data[2]["tickets"][0]["ticketName"], "ZZZ")

    def test_persist_watchlist_scoped_updates_named_list(self):
        set_watchlists(_watchlists_fixture())
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "watchlist.json"

            persist_watchlist(["MSFT"], path, name="Growth")
            data = json.loads(path.read_text())

        self.assertEqual([t["symbol"] for t in data[0]["tickets"]], ["TSM"])
        self.assertEqual([t["symbol"] for t in data[1]["tickets"]], ["MSFT"])


class WatchlistListTests(unittest.TestCase):
    def test_list_watchlists_returns_names_and_counts(self):
        with patch(
            "backend.main._get_watchlists", return_value=_watchlists_fixture()
        ):
            result = list_watchlists()

        self.assertEqual(
            result,
            {
                "watchlists": [
                    {"name": "Watchlist 1", "count": 1},
                    {"name": "Growth", "count": 1},
                ]
            },
        )


class ScopedWatchlistEndpointTests(unittest.TestCase):
    def test_get_watchlist_for_named_list_uses_its_symbols(self):
        with (
            patch("backend.main._get_watchlist", return_value=["AAPL"]) as get,
            patch("backend.main._download", return_value=_quote_frame()) as download,
        ):
            result = get_watchlist_quotes("Growth")

        get.assert_called_once_with("Growth")
        download.assert_called_once_with(
            tickers=["AAPL"], period="5d", interval="1d", group_by="ticker"
        )
        self.assertEqual(result["quotes"][0]["symbol"], "AAPL")

    def test_get_watchlist_legacy_defaults_to_first_list(self):
        with (
            patch("backend.main._get_watchlist", return_value=["TSM"]) as get,
            patch("backend.main._download", return_value=_quote_frame()),
        ):
            result = get_watchlist_quotes()

        get.assert_called_once_with(None)
        self.assertEqual(result["quotes"][0]["symbol"], "TSM")

    def test_get_watchlist_empty_list_skips_download(self):
        with (
            patch("backend.main._get_watchlist", return_value=[]),
            patch("backend.main._download") as download,
        ):
            result = get_watchlist_quotes("Empty")

        self.assertEqual(result, {"quotes": []})
        download.assert_not_called()

    def test_get_watchlist_unknown_name_returns_404(self):
        with patch("backend.main._get_watchlist", return_value=None):
            with self.assertRaises(HTTPException) as error:
                get_watchlist_quotes("Unknown")

        self.assertEqual(error.exception.status_code, 404)

    def test_add_symbol_to_named_watchlist(self):
        with (
            patch("backend.main._get_watchlist", return_value=["TSM"]) as get,
            patch("backend.main._download", return_value=_quote_frame()),
            patch(
                "backend.main.fetch_symbol_info", return_value=("New Co", "NASDAQ")
            ),
            patch("backend.main._set_watchlist") as set_,
            patch("backend.main._persist_watchlist") as persist,
        ):
            result = add_symbol(AddSymbol(symbol="NEW", watchlist="Growth"), _csrf_request())

        get.assert_any_call("Growth")
        self.assertEqual(get.call_count, 2)
        set_.assert_called_once_with(["TSM", "NEW"], "Growth")
        persist.assert_called_once()
        self.assertEqual(persist.call_args.args[0], ["TSM", "NEW"])
        self.assertEqual(persist.call_args.kwargs, {"name": "Growth"})
        self.assertEqual(persist.call_args.args[1]("NEW"), ("New Co", "NASDAQ"))
        self.assertEqual(result["quote"]["symbol"], "NEW")

    def test_add_symbol_unknown_watchlist_returns_404(self):
        with (
            patch("backend.main._get_watchlist", return_value=None),
            patch("backend.main._download") as download,
        ):
            with self.assertRaises(HTTPException) as error:
                add_symbol(AddSymbol(symbol="NEW", watchlist="Unknown"), _csrf_request())

        self.assertEqual(error.exception.status_code, 404)
        download.assert_not_called()

    def test_add_symbol_duplicate_in_named_watchlist_returns_409(self):
        with (
            patch("backend.main._get_watchlist", return_value=["NEW"]),
            patch("backend.main._download") as download,
        ):
            with self.assertRaises(HTTPException) as error:
                add_symbol(AddSymbol(symbol="NEW", watchlist="Growth"), _csrf_request())

        self.assertEqual(error.exception.status_code, 409)
        download.assert_not_called()

    def test_remove_symbol_from_named_watchlist(self):
        with (
            patch("backend.main._get_watchlist", return_value=["AAPL"]) as get,
            patch("backend.main._set_watchlist") as set_,
            patch("backend.main._persist_watchlist") as persist,
        ):
            result = remove_from_watchlist("AAPL", _csrf_request(), "Growth")

        get.assert_called_once_with("Growth")
        set_.assert_called_once_with([], "Growth")
        persist.assert_called_once_with([], name="Growth")
        self.assertEqual(result, {"removed": "AAPL"})

    def test_remove_symbol_unknown_watchlist_returns_404(self):
        with (
            patch("backend.main._get_watchlist", return_value=None),
            patch("backend.main._set_watchlist") as set_,
        ):
            with self.assertRaises(HTTPException) as error:
                remove_from_watchlist("AAPL", _csrf_request(), "Unknown")

        self.assertEqual(error.exception.status_code, 404)
        set_.assert_not_called()

    def test_remove_symbol_missing_from_named_watchlist_returns_404(self):
        with (
            patch("backend.main._get_watchlist", return_value=["AAPL"]),
            patch("backend.main._set_watchlist") as set_,
        ):
            with self.assertRaises(HTTPException) as error:
                remove_from_watchlist("TSM", _csrf_request(), "Growth")

        self.assertEqual(error.exception.status_code, 404)
        set_.assert_not_called()


class LegacyEndpointTests(unittest.TestCase):
    def test_legacy_post_delegates_to_add_symbol(self):
        expected = {"quote": {"symbol": "NEW"}}
        with patch("backend.main.add_symbol", return_value=expected) as add:
            result = add_to_watchlist(AddSymbol(symbol="NEW"), _csrf_request())

        add.assert_called_once()
        self.assertEqual(result, expected)


class WatchlistCrudTests(unittest.TestCase):
    def test_create_watchlist_appends_trimmed_name(self):
        with (
            patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ),
            patch("backend.main._set_watchlists") as set_,
            patch("backend.main._persist_watchlists") as persist,
        ):
            result = create_watchlist(WatchlistName(name="  Dividend "), _csrf_request())

        lists = set_.call_args.args[0]
        self.assertEqual(lists[-1], {"watchlistName": "Dividend", "tickets": []})
        persist.assert_called_once_with(lists)
        self.assertEqual(result, {"name": "Dividend", "count": 0})

    def test_create_watchlist_duplicate_name_is_case_insensitive(self):
        with (
            patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ),
            patch("backend.main._set_watchlists") as set_,
        ):
            with self.assertRaises(HTTPException) as error:
                create_watchlist(WatchlistName(name="watchlist 1"), _csrf_request())

        self.assertEqual(error.exception.status_code, 409)
        set_.assert_not_called()

    def test_create_watchlist_rejects_blank_or_too_long_names(self):
        for name in ("   ", "x" * 41):
            with patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ):
                with self.assertRaises(HTTPException) as error:
                    create_watchlist(WatchlistName(name=name), _csrf_request())

            self.assertEqual(error.exception.status_code, 422)

    def test_create_watchlist_requires_csrf(self):
        req = MagicMock()
        req.headers.get.return_value = None

        with self.assertRaises(HTTPException) as error:
            create_watchlist(WatchlistName(name="Dividend"), req)

        self.assertEqual(error.exception.status_code, 403)

    def test_rename_watchlist_updates_name(self):
        with (
            patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ),
            patch("backend.main._set_watchlists") as set_,
            patch("backend.main._persist_watchlists"),
        ):
            result = rename_watchlist(
                "Growth", WatchlistName(name="Quality"), _csrf_request()
            )

        lists = set_.call_args.args[0]
        self.assertEqual(lists[1]["watchlistName"], "Quality")
        self.assertEqual(lists[1]["tickets"][0]["symbol"], "AAPL")
        self.assertEqual(result, {"name": "Quality", "count": 1})

    def test_rename_watchlist_allows_case_only_change(self):
        with (
            patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ),
            patch("backend.main._set_watchlists") as set_,
            patch("backend.main._persist_watchlists"),
        ):
            result = rename_watchlist(
                "Growth", WatchlistName(name="GROWTH"), _csrf_request()
            )

        lists = set_.call_args.args[0]
        self.assertEqual(lists[1]["watchlistName"], "GROWTH")
        self.assertEqual(result, {"name": "GROWTH", "count": 1})

    def test_rename_watchlist_guards(self):
        with patch(
            "backend.main._get_watchlists", return_value=_watchlists_fixture()
        ):
            with self.assertRaises(HTTPException) as error:
                rename_watchlist(
                    "Unknown", WatchlistName(name="Quality"), _csrf_request()
                )
            self.assertEqual(error.exception.status_code, 404)

            with self.assertRaises(HTTPException) as error:
                rename_watchlist(
                    "Growth", WatchlistName(name="watchlist 1"), _csrf_request()
                )
            self.assertEqual(error.exception.status_code, 409)

            with self.assertRaises(HTTPException) as error:
                rename_watchlist("Growth", WatchlistName(name=" "), _csrf_request())
            self.assertEqual(error.exception.status_code, 422)

    def test_delete_watchlist_removes_named_list(self):
        with (
            patch(
                "backend.main._get_watchlists", return_value=_watchlists_fixture()
            ),
            patch("backend.main._set_watchlists") as set_,
            patch("backend.main._persist_watchlists") as persist,
        ):
            result = delete_watchlist("Growth", _csrf_request())

        lists = set_.call_args.args[0]
        self.assertEqual([w["watchlistName"] for w in lists], ["Watchlist 1"])
        persist.assert_called_once_with(lists)
        self.assertEqual(result, {"deleted": "Growth"})

    def test_delete_watchlist_guards(self):
        with patch(
            "backend.main._get_watchlists", return_value=_watchlists_fixture()
        ), patch("backend.main._set_watchlists") as set_:
            with self.assertRaises(HTTPException) as error:
                delete_watchlist("Unknown", _csrf_request())
            self.assertEqual(error.exception.status_code, 404)

        with patch(
            "backend.main._get_watchlists",
            return_value=[
                {"watchlistName": "Only", "tickets": []},
            ],
        ), patch("backend.main._set_watchlists") as set_:
            with self.assertRaises(HTTPException) as error:
                delete_watchlist("Only", _csrf_request())
            self.assertEqual(error.exception.status_code, 409)
            set_.assert_not_called()


if __name__ == "__main__":
    unittest.main()