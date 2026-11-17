import json
import threading
from collections.abc import Callable
from pathlib import Path

from backend.symbols import DEFAULT_WATCHLIST, STOCK_NAMES

# Thread-safe watchlist state
_watchlist_lock = threading.Lock()
_watchlist: list[str] = []


def load_watchlist(path: Path) -> list[str]:
    """Load symbols from watchlist.json (first watchlist's tickets)."""
    try:
        with open(path, "r") as f:
            data = json.load(f)
        if data and isinstance(data, list) and len(data) > 0:
            tickets = data[0].get("tickets", [])
            return [t["symbol"] for t in tickets if "symbol" in t]
    except (FileNotFoundError, json.JSONDecodeError, KeyError, IndexError):
        pass
    # Fallback to defaults if file missing or corrupt
    return list(DEFAULT_WATCHLIST)


def persist_watchlist(
    symbols: list[str],
    path: Path,
    resolve_info: Callable[[str], tuple[str, str]] | None = None,
) -> None:
    """Persist watchlist symbols to JSON file with thread safety."""
    with _watchlist_lock:
        try:
            with open(path, "r") as f:
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
                    if resolve_info is not None:
                        name, exchange = resolve_info(sym)
                    else:
                        name, exchange = STOCK_NAMES.get(sym, (sym, "MARKET"))
                    new_tickets.append({"symbol": sym, "ticketName": name, "exchange": exchange})
            data[0]["tickets"] = new_tickets

        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)


def get_watchlist() -> list[str]:
    """Thread-safe accessor for the global watchlist."""
    with _watchlist_lock:
        return list(_watchlist)


def set_watchlist(symbols: list[str]) -> None:
    """Thread-safe setter for the global watchlist."""
    with _watchlist_lock:
        _watchlist.clear()
        _watchlist.extend(symbols)
