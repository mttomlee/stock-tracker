"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Quote, WatchlistSummary } from "../lib/types";
import { exchangeLabel, nameLabel, priceLabel, signed, symbolLabel } from "../lib/format";

type WatchlistProps = {
  quotes: Quote[];
  selected: string;
  loading: boolean;
  activeName: string;
  watchlists: WatchlistSummary[];
  loadingWatchlists: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onShowAdd: () => void;
  onSwitch: (name: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: (name: string) => void;
};

export default function Watchlist({
  quotes,
  selected,
  loading,
  activeName,
  watchlists,
  loadingWatchlists,
  triggerRef,
  onSelect,
  onRemove,
  onShowAdd,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: WatchlistProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? localTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
      setFocusIndex(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, trigger]);

  const activeIndex = watchlists.findIndex((watchlist) => watchlist.name === activeName);
  const currentIndex = focusIndex ?? (activeIndex >= 0 ? activeIndex : 0);

  // Move focus into the menu onto the active list when it opens.
  useEffect(() => {
    if (!open) return;
    const activeItem = watchlists.findIndex((watchlist) => watchlist.name === activeName);
    itemRefs.current[activeItem >= 0 ? activeItem : 0]?.focus();
  }, [open, watchlists, activeName]);

  function closeMenu(returnFocus = false) {
    setOpen(false);
    setFocusIndex(null);
    if (returnFocus) trigger.current?.focus();
  }

  function enabledIndexes() {
    return itemRefs.current
      .map((item, index) => (item && !item.disabled ? index : -1))
      .filter((index) => index >= 0);
  }

  function moveFocus(from: number, offset: 1 | -1) {
    const enabled = enabledIndexes();
    if (enabled.length === 0) return;
    const position = enabled.indexOf(from);
    const nextPosition = position === -1
      ? offset === 1 ? 0 : enabled.length - 1
      : (position + offset + enabled.length) % enabled.length;
    itemRefs.current[enabled[nextPosition]]?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      // Closing unmounts the focused item, so return focus to the trigger.
      event.preventDefault();
      closeMenu(true);
      return;
    }
    const from = Number((event.target as HTMLElement).dataset.index ?? -1);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(from, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const enabled = enabledIndexes();
      if (enabled.length === 0) return;
      itemRefs.current[event.key === "Home" ? enabled[0] : enabled[enabled.length - 1]]?.focus();
    }
  }

  function chooseList(name: string) {
    onSwitch(name);
    closeMenu(true);
  }

  function chooseNew() {
    closeMenu();
    onCreate();
  }

  function chooseRename() {
    closeMenu();
    onRename();
  }

  function chooseDelete() {
    closeMenu(true);
    if (watchlists.length <= 1) return;
    if (window.confirm(`Delete the watchlist "${activeName}"?`)) onDelete(activeName);
  }

  const newIndex = watchlists.length;
  const renameIndex = newIndex + 1;
  const deleteIndex = renameIndex + 1;

  return (
    <aside className="side" aria-busy={loadingWatchlists || loading}>
      <div className="watchlist-heading">
        <h1>
          <button
            ref={trigger}
            className="watchlist-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls="watchlist-menu"
            disabled={loadingWatchlists}
            onClick={() => setOpen((current) => !current)}
          >
            <span className="watchlist-trigger-name">
              {loadingWatchlists ? "Loading..." : activeName}
            </span>
            <svg className={`watchlist-caret${open ? " is-open" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </h1>
        <span>{quotes.length} symbols</span>
        {open && (
          <div
            ref={menuRef}
            className="watchlist-menu"
            id="watchlist-menu"
            role="menu"
            aria-label="Watchlists"
            onKeyDown={handleMenuKeyDown}
          >
            {watchlists.map((watchlist, index) => {
              const active = watchlist.name === activeName;
              return (
                <button
                  key={watchlist.name}
                  ref={(element) => { itemRefs.current[index] = element; }}
                  className="watchlist-menu-item"
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={index === currentIndex ? 0 : -1}
                  data-index={index}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => chooseList(watchlist.name)}
                >
                  <span className="watchlist-menu-name">{watchlist.name}</span>
                  {active && (
                    <svg className="watchlist-menu-check" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12l4 4 10-10" />
                    </svg>
                  )}
                </button>
              );
            })}
            <div className="watchlist-menu-separator" role="separator" />
            <button
              ref={(element) => { itemRefs.current[newIndex] = element; }}
              className="watchlist-menu-item"
              type="button"
              role="menuitem"
              tabIndex={newIndex === currentIndex ? 0 : -1}
              data-index={newIndex}
              onFocus={() => setFocusIndex(newIndex)}
              onClick={chooseNew}
            >
              New watchlist
            </button>
            <button
              ref={(element) => { itemRefs.current[renameIndex] = element; }}
              className="watchlist-menu-item"
              type="button"
              role="menuitem"
              tabIndex={renameIndex === currentIndex ? 0 : -1}
              data-index={renameIndex}
              onFocus={() => setFocusIndex(renameIndex)}
              onClick={chooseRename}
            >
              Rename
            </button>
            <button
              ref={(element) => { itemRefs.current[deleteIndex] = element; }}
              className="watchlist-menu-item watchlist-menu-danger"
              type="button"
              role="menuitem"
              disabled={watchlists.length <= 1}
              tabIndex={deleteIndex === currentIndex ? 0 : -1}
              data-index={deleteIndex}
              onFocus={() => setFocusIndex(deleteIndex)}
              onClick={chooseDelete}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <div className="watchlist-actions">
        <button className="add-symbol" disabled={!activeName} onClick={onShowAdd}>+ Add symbol</button>
        <button className="add-alert" type="button" title="Price alerts are not available yet">+ Add alert</button>
      </div>
      <div className="watchlist" aria-label="Watchlist">
        {loading && quotes.length === 0 ? (
          <div className="sidebar-message">Loading watchlist…</div>
        ) : quotes.length === 0 ? (
          <div className="sidebar-message watchlist-empty">
            <p>No symbols yet.</p>
            <button type="button" disabled={!activeName} onClick={onShowAdd}>Add symbol</button>
          </div>
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
