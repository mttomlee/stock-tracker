import re

SYMBOL_PATTERN = re.compile(r"^[A-Z0-9^.=/-]{1,20}$")
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
DEFAULT_WATCHLIST = ["TSM", "AAPL", "AMZN", "ARM", "BABA", "BTC-USD", "GOOG", "JPM"]


def symbol_details(symbol: str) -> tuple[str, str]:
    return STOCK_NAMES.get(symbol, (symbol, "MARKET"))
