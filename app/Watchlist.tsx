"use client";

import type { Quote } from "../lib/types";
import { exchangeLabel, nameLabel, priceLabel, signed, symbolLabel } from "../lib/format";

type WatchlistProps = {
  quotes: Quote[];
  selected: string;
  loading: boolean;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onShowAdd: () => void;
};

export default function Watchlist({
  quotes,
  selected,
  loading,
  onSelect,
  onRemove,
  onShowAdd,
}: WatchlistProps) {
  return (
    <aside className="side">
      <div className="watchlist-heading">
        <h1>My watchlist</h1>
        <span>{quotes.length} symbols</span>
      </div>
      <div className="watchlist-actions">
        <button className="add-symbol" onClick={onShowAdd}>+ Add symbol</button>
        <button className="add-alert" type="button" title="Price alerts are not available yet">+ Add alert</button>
      </div>
      <div className="watchlist" aria-label="Watchlist">
        {loading && quotes.length === 0 ? (
          <div className="sidebar-message">Loading watchlist…</div>
        ) : quotes.length === 0 ? (
          <div className="sidebar-message">Your watchlist is empty.</div>
        ) : (
          quotes.map((quote) => (
            <div className={`watch-row-wrap ${selected === quote.symbol ? "selected" : ""}`} key={quote.symbol}>
              <button className="watch-row" onClick={() => onSelect(quote.symbol)}>
                <span className="watch-row-identity">
                  <span>
                    <b>{symbolLabel(quote.symbol)}</b>
                    <span className="exchange">{exchangeLabel(quote.exchange)}</span>
                  </span>
                  <span className="company-name">{nameLabel(quote)}</span>
                </span>
                <span className="watch-row-price">
                  <b>{priceLabel(quote.price, quote.symbol, quote.symbol !== "BTC-USD")}</b>
                  <span className={quote.change_percent >= 0 ? "positive" : "negative"}>
                    {signed(quote.change_percent, "%")}
                  </span>
                </span>
              </button>
              <button className="remove-symbol" aria-label={`Remove ${symbolLabel(quote.symbol)}`} onClick={() => onRemove(quote.symbol)}>×</button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
