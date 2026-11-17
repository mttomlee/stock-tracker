import json
import os
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from backend.symbols import DEFAULT_WATCHLIST, STOCK_NAMES

# Reentrant so callers can hold it across a read-modify-write sequence.
_watchlist_lock = threading.RLock()
_watchlists: list[dict] = []


def watchlists_lock() -> threading.RLock:
    """Lock for callers that must read, mutate, and persist atomically."""
    return _watchlist_lock


def _seed() -> list[dict]:
    return [
        {
            "watchlistName": "Watchlist 1",
            "tickets": [{"symbol": symbol} for symbol in DEFAULT_WATCHLIST],
        }
    ]


def _find(watchlists: list[dict], name: str | None) -> dict | None:
    if not watchlists:
        return None
    if name is None:
        return watchlists[0]
    key = name.strip().casefold()
    for watchlist in watchlists:
        if watchlist["watchlistName"].casefold() == key:
            return watchlist
    return None


def load_watchlists(path: Path) -> list[dict]:
    """Load every named watchlist; missing/corrupt/empty file seeds the default."""
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return _seed()

    watchlists = []
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            name = item.get("watchlistName")
            if not isinstance(name, str) or not name.strip():
                continue
            raw_tickets = item.get("tickets")
            tickets = [
                dict(ticket)
                for ticket in (raw_tickets if isinstance(raw_tickets, list) else [])
                if isinstance(ticket, dict)
                and isinstance(ticket.get("symbol"), str)
                and ticket["symbol"]
            ]
            watchlists.append({"watchlistName": name.strip(), "tickets": tickets})
    return watchlists or _seed()


def load_watchlist(path: Path, name: str | None = None) -> list[str]:
    """Load symbols from the named watchlist (first list when name is omitted)."""
    watchlist = _find(load_watchlists(path), name)
    return [ticket["symbol"] for ticket in watchlist["tickets"]] if watchlist else []


def persist_watchlists(
    watchlists: list[dict],
    path: Path,
    resolve_info: Callable[[str], tuple[str, str]] | None = None,
) -> None:
    """Persist every named watchlist, filling ticketName/exchange for bare tickets."""
    with _watchlist_lock:
        out = []
        for watchlist in watchlists:
            tickets = []
            for ticket in watchlist.get("tickets", []):
                symbol = ticket.get("symbol")
                if not symbol:
                    continue
                name, exchange = ticket.get("ticketName"), ticket.get("exchange")
                if not name or not exchange:
                    if resolve_info is not None:
                        name, exchange = resolve_info(symbol)
                    else:
                        name, exchange = STOCK_NAMES.get(symbol, (symbol, "MARKET"))
                tickets.append(
                    {"symbol": symbol, "ticketName": name, "exchange": exchange}
                )
            out.append({"watchlistName": watchlist["watchlistName"], "tickets": tickets})

        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".watchlist-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(out, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
            raise


def persist_watchlist(
    symbols: list[str],
    path: Path,
    resolve_info: Callable[[str], tuple[str, str]] | None = None,
    name: str | None = None,
) -> None:
    """Compatibility: persist symbols as one watchlist (first when name is omitted)."""
    watchlists = get_watchlists()
    if not watchlists:
        watchlists = [{"watchlistName": "Watchlist 1", "tickets": []}]
    watchlist = _find(watchlists, name)
    if watchlist is None:
        return
    existing = {ticket["symbol"]: ticket for ticket in watchlist["tickets"]}
    watchlist["tickets"] = [
        existing.get(symbol, {"symbol": symbol}) for symbol in symbols
    ]
    persist_watchlists(watchlists, path, resolve_info)


def get_watchlists() -> list[dict]:
    """Thread-safe snapshot of every named watchlist."""
    with _watchlist_lock:
        return [
            {
                "watchlistName": watchlist["watchlistName"],
                "tickets": [dict(ticket) for ticket in watchlist["tickets"]],
            }
            for watchlist in _watchlists
        ]


def set_watchlists(watchlists: list[dict]) -> None:
    """Thread-safe setter for the global watchlists."""
    with _watchlist_lock:
        _watchlists.clear()
        _watchlists.extend(
            {
                "watchlistName": watchlist["watchlistName"],
                "tickets": [dict(ticket) for ticket in watchlist.get("tickets", [])],
            }
            for watchlist in watchlists
        )


def get_watchlist(name: str | None = None) -> list[str] | None:
    """Thread-safe symbols for the named watchlist (first when omitted).

    Returns None only when a name was given and no such list exists.
    """
    with _watchlist_lock:
        watchlist = _find(_watchlists, name)
        if watchlist is None:
            return None if name is not None else []
        return [ticket["symbol"] for ticket in watchlist["tickets"]]


def set_watchlist(symbols: list[str], name: str | None = None) -> None:
    """Thread-safe setter for one watchlist, preserving existing ticket info."""
    with _watchlist_lock:
        watchlist = _find(_watchlists, name)
        if watchlist is None:
            if name is not None:
                raise KeyError(name)
            watchlist = {"watchlistName": "Watchlist 1", "tickets": []}
            _watchlists.append(watchlist)
        existing = {ticket["symbol"]: ticket for ticket in watchlist["tickets"]}
        watchlist["tickets"] = [
            dict(existing[symbol]) if symbol in existing else {"symbol": symbol}
            for symbol in symbols
        ]


def set_ticket_info(
    symbol: str, name: str, exchange: str, watchlist_name: str | None = None
) -> None:
    """Store resolved metadata so later persists don't fall back to placeholders."""
    with _watchlist_lock:
        watchlist = _find(_watchlists, watchlist_name)
        if watchlist is None:
            return
        for ticket in watchlist["tickets"]:
            if ticket.get("symbol") == symbol:
                ticket["ticketName"] = name
                ticket["exchange"] = exchange
                return
