"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import DateRangePicker from "./DateRangePicker";
import ErrorBoundary from "./ErrorBoundary";
import Watchlist from "./Watchlist";
import AddSymbolModal from "./AddSymbolModal";
import WatchlistNameModal from "./WatchlistNameModal";
import CandleChart from "./charts/CandleChart";
import PriceAxis from "./charts/PriceAxis";
import MacdChart from "./charts/MacdChart";
import RsiChart from "./charts/RsiChart";
import { AVERAGES, MACD_HEIGHT, RSI_HEIGHT } from "./charts/constants";
import { macdScale, rsiScale } from "./charts/scale";
import { request } from "../lib/api";
import { dateLabel, exchangeLabel, priceLabel, signed, signedPrice, symbolLabel } from "../lib/format";
import type { ChartRange, History, Quote, WatchlistSummary } from "../lib/types";

type NameModalState = { mode: "create" } | { mode: "rename"; name: string };

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState("");
  const range: ChartRange = "1W";
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [hoverMacd, setHoverMacd] = useState<number | null>(null);
  const [hoverRsi, setHoverRsi] = useState<number | null>(null);
  // Crosshair position in screen coordinates, reported directly by the chart panes via SVG CTM
  const [crosshairLineScreenX, setCrosshairLineScreenX] = useState<number | null>(null);
  const [error, setError] = useState("");
  const dateLabelRef = useRef<HTMLSpanElement>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [activeWatchlist, setActiveWatchlist] = useState("");
  const [loadingWatchlists, setLoadingWatchlists] = useState(true);
  const [nameModal, setNameModal] = useState<NameModalState | null>(null);
  const watchlistTriggerRef = useRef<HTMLButtonElement>(null);

  // Hover state belongs to the plotted series; clear it whenever the series changes.
  function clearHover() {
    setHoverIndex(null);
    setHoverPrice(null);
    setHoverMacd(null);
    setHoverRsi(null);
    setCrosshairLineScreenX(null);
  }

  const rangeIsValid =
    !(startDate || endDate) || Boolean(startDate && endDate && startDate <= endDate);

  useEffect(() => {
    const controller = new AbortController();
    request<{ watchlists: WatchlistSummary[] }>("/api/watchlists", { signal: controller.signal })
      .then(({ watchlists: nextWatchlists }) => {
        setWatchlists(nextWatchlists);
        setActiveWatchlist(nextWatchlists[0]?.name ?? "");
        if (nextWatchlists.length === 0) setLoadingQuotes(false);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setError(`Could not load watchlists: ${reason.message}`);
          setLoadingQuotes(false);
        }
      })
      .finally(() => setLoadingWatchlists(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeWatchlist) return;
    const controller = new AbortController();
    request<{ quotes: Quote[] }>(
      `/api/watchlist?${new URLSearchParams({ watchlist: activeWatchlist })}`,
      { signal: controller.signal },
    )
      .then(({ quotes: nextQuotes }) => {
        setQuotes(nextQuotes);
        setSelected((current) =>
          nextQuotes.some((quote) => quote.symbol === current)
            ? current
            : (nextQuotes[0]?.symbol ?? ""),
        );
        setLoadingChart(nextQuotes.length > 0 && rangeIsValid);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setError(`Could not load watchlist: ${reason.message}`);
          setLoadingChart(false);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingQuotes(false);
      });
    return () => controller.abort();
  }, [activeWatchlist, rangeIsValid]);

  useEffect(() => {
    if (!selected) return;
    if (startDate || endDate) {
      if (!startDate || !endDate || startDate > endDate) return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ symbol: selected });
    if (startDate && endDate) {
      params.set("start", startDate);
      params.set("end", endDate);
    } else {
      params.set("range", range);
    }
    request<History>(`/api/stocks/history?${params}`, { signal: controller.signal })
      .then((data) => {
        setHistory(data);
        setError("");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          // A failed fetch must not leave the previous range's candles on screen.
          setHistory(null);
          setError(`Could not load chart: ${reason.message}`);
        }
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        // Hover belongs to the series that was plotted when it was set; the
        // settled series may be shorter or empty, so index 0 is not a safe fallback.
        setHoverIndex(null);
        setHoverPrice(null);
        setHoverMacd(null);
        setHoverRsi(null);
        setCrosshairLineScreenX(null);
        setLoadingChart(false);
      });
    return () => controller.abort();
  }, [endDate, range, selected, startDate]);

  async function addSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol || !activeWatchlist) return;
    setAdding(true);
    setError("");
    try {
      const result = await request<{ quote: Quote }>("/api/watchlist/add_symbol", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ symbol, watchlist: activeWatchlist }),
      });
      const quote: Quote = result.quote;
      setQuotes((current) => [...current, quote]);
      clearHover();
      setSelected(quote.symbol);
      setLoadingChart(rangeIsValid);
      setSymbolInput("");
    } catch (reason) {
      setError(`Could not add ${symbol}: ${(reason as Error).message}`);
    } finally {
      setAdding(false);
      setShowAdd(false);
    }
  }

  async function removeSymbol(symbol: string) {
    setError("");
    try {
      await request(`/api/watchlist?${new URLSearchParams({ symbol, watchlist: activeWatchlist })}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const remaining = quotes.filter((quote) => quote.symbol !== symbol);
      setQuotes(remaining);
      if (selected === symbol) {
        clearHover();
        setSelected(remaining[0]?.symbol ?? "");
        setLoadingChart(remaining.length > 0 && rangeIsValid);
        if (remaining.length === 0) setHistory(null);
      }
    } catch (reason) {
      setError(`Could not remove ${symbol}: ${(reason as Error).message}`);
    }
  }

  async function refreshWatchlists() {
    const { watchlists: nextWatchlists } = await request<{ watchlists: WatchlistSummary[] }>(
      "/api/watchlists",
    );
    setWatchlists(nextWatchlists);
    return nextWatchlists;
  }

  function switchWatchlist(name: string) {
    if (name === activeWatchlist) return;
    setQuotes([]);
    setSelected("");
    setHistory(null);
    clearHover();
    setLoadingChart(true);
    setLoadingQuotes(true);
    setActiveWatchlist(name);
  }

  function closeNameModal() {
    setNameModal(null);
    watchlistTriggerRef.current?.focus();
  }

  async function createWatchlist(name: string) {
    await request("/api/watchlists", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ name }),
    });
    await refreshWatchlists();
    switchWatchlist(name);
    closeNameModal();
  }

  async function renameWatchlist(currentName: string, name: string) {
    await request(`/api/watchlists/${encodeURIComponent(currentName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ name }),
    });
    await refreshWatchlists();
    if (currentName === activeWatchlist) switchWatchlist(name);
    closeNameModal();
  }

  async function deleteWatchlist(name: string) {
    setError("");
    try {
      await request(`/api/watchlists/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const nextWatchlists = await refreshWatchlists();
      if (name === activeWatchlist) switchWatchlist(nextWatchlists[0]?.name ?? "");
    } catch (reason) {
      setError(`Could not delete ${name}: ${(reason as Error).message}`);
    }
  }

  function selectSymbol(symbol: string) {
    if (selected === symbol) return;
    clearHover();
    setSelected(symbol);
    setLoadingChart(rangeIsValid);
  }

  const activeQuote = quotes.find((quote) => quote.symbol === selected);
  const candles = history?.symbol === selected ? history.candles : [];
  const active = candles[hoverIndex ?? candles.length - 1];
  const prevClose = candles[(hoverIndex ?? candles.length - 1) - 1]?.close;
  // prevClose truthiness also guards the percent divide.
  const closeChange = active && prevClose ? active.close - prevClose : null;
  const changePercent = closeChange === null || !prevClose ? null : (closeChange / prevClose) * 100;
  const changeClass = closeChange !== null && closeChange < 0 ? "negative" : "positive";
  const macdHover = hoverMacd === null || candles.length === 0 ? null : { top: (macdScale(candles).y(hoverMacd) / MACD_HEIGHT) * 100, label: hoverMacd.toFixed(4) };
  const rsiHover = hoverRsi === null || candles.length === 0 ? null : { top: (rsiScale().y(hoverRsi) / RSI_HEIGHT) * 100, label: hoverRsi.toFixed(2) };
  const visibleError =
    startDate && endDate && startDate > endDate
      ? "Start date must be on or before end date."
      : error;
  const defaultStart = candles[0]?.date.slice(0, 10) ?? "";
  const defaultEnd = candles[candles.length - 1]?.date.slice(0, 10) ?? "";

  // Crosshair position is reported directly by the chart panes via SVG CTM.
  const footerRef = useRef<HTMLDivElement>(null);
  const chartsWrapperRef = useRef<HTMLDivElement>(null);
  const [dateLabelLeft, setDateLabelLeft] = useState(0);
  const [crosshairLineLeft, setCrosshairLineLeft] = useState(0);

  // Recompute the label's left offset whenever the line moves. The label is
  // absolutely positioned inside the footer (position: relative), so its
  // left edge = footerLeft + dateLabelLeft. With no translate(-50%), the
  // label's center is at footerLeft + dateLabelLeft + labelWidth/2. We set
  // dateLabelLeft so that center equals the line's screen center X.
  useEffect(() => {
    if (crosshairLineScreenX === null) return;
    const footer = footerRef.current;
    const label = dateLabelRef.current;
    if (!footer || !label) return;
    const footerRect = footer.getBoundingClientRect();
    const labelWidth = label.offsetWidth;
    let left = crosshairLineScreenX - footerRect.left - labelWidth / 2;
    // Clamp so the label never spills left into the sidebar/watchlist section.
    left = Math.max(left, 8);
    setDateLabelLeft(left);
  }, [crosshairLineScreenX]);

  // Crosshair screen X is reported directly by CandleChart via onCrosshairScreenX
  // using the SVG's CTM, which maps viewBox X to screen X for every pane.

  // Recompute the global crosshair line's left offset relative to charts wrapper.
  useEffect(() => {
    if (crosshairLineScreenX === null) return;
    const wrapper = chartsWrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const left = crosshairLineScreenX - wrapperRect.left;
    setCrosshairLineLeft(left);
  }, [crosshairLineScreenX]);

  return (
    <div className="app">
      <Watchlist
        quotes={quotes}
        selected={selected}
        loading={loadingQuotes}
        activeName={activeWatchlist}
        watchlists={watchlists}
        loadingWatchlists={loadingWatchlists}
        triggerRef={watchlistTriggerRef}
        onSelect={selectSymbol}
        onRemove={removeSymbol}
        onShowAdd={() => setShowAdd(true)}
        onSwitch={switchWatchlist}
        onCreate={() => setNameModal({ mode: "create" })}
        onRename={() => setNameModal({ mode: "rename", name: activeWatchlist })}
        onDelete={deleteWatchlist}
      />

      <main>
        <header className="chart-header">
          <div className="quote-heading">
            <h2>{symbolLabel(selected)}</h2>
            <span className="quote-meta">
              {activeQuote ? exchangeLabel(activeQuote.exchange) : "—"} ·{" "}
              {startDate && endDate ? `${startDate} – ${endDate}` : range}
            </span>
            <span className="header-price">{activeQuote ? priceLabel(activeQuote.price, selected) : "—"}</span>
            {activeQuote && (
              <span className={`header-change ${activeQuote.change >= 0 ? "positive" : "negative"}`}>
                {signed(activeQuote.change)} · {signed(activeQuote.change_percent, "%")}
              </span>
            )}
          </div>
          <DateRangePicker
            start={startDate}
            end={endDate}
            defaultStart={defaultStart}
            defaultEnd={defaultEnd}
            defaultPreset={range}
            onApply={(start, end) => {
              setError("");
              if (start !== startDate || end !== endDate) {
                clearHover();
                setLoadingChart(true);
                setStartDate(start);
                setEndDate(end);
              }
            }}
          />
        </header>

        {visibleError && (
          <div className="error-banner" role="alert">
            <span>{visibleError}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">×</button>
          </div>
        )}

        {/* Wrapper for all three charts to host a single continuous crosshair line */}
        <div className="charts-wrapper" ref={chartsWrapperRef} style={{ position: "relative" }}>
          <section className="price-chart" aria-label="Price chart">
          <div className="chart-legend-stack">
            {active && (
              <div className="ohlc-row">
                <div className="change-legend" role="group" aria-label="Change from previous close">
                  {closeChange === null || changePercent === null ? (
                    <span aria-label="No previous candle">—</span>
                  ) : (
                    <>
                      <span className={changeClass} aria-label={`Price change ${signedPrice(closeChange, selected)}`}>
                        {signedPrice(closeChange, selected)}
                      </span>
                      <span className={changeClass} aria-label={`Percent change ${signed(changePercent, "%")}`}>
                        {signed(changePercent, "%")}
                      </span>
                    </>
                  )}
                </div>
                <div className="ohlc-legend">
                  {([["O", "open", "Open"], ["H", "high", "High"], ["L", "low", "Low"], ["C", "close", "Close"]] as const).map(([short, key, full]) => (
                    <span key={key} aria-label={`${full} ${priceLabel(active[key], selected)}`}>
                      {short} <b>{priceLabel(active[key], selected)}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="main-indicator-legend">
              <span>EMA <b>9</b> · <b>21</b> · <b>50</b> · <b>200</b></span>
              {active && AVERAGES.map(({ key, label, color }) => (
                <span key={key} style={{ color }} aria-label={`${label} ${priceLabel(active[key], selected)}`}>
                  {priceLabel(active[key], selected)}
                </span>
              ))}
            </div>
          </div>
          {loadingChart ? (
            <div className="chart-placeholder">Loading price history…</div>
          ) : candles.length > 0 ? (
            <ErrorBoundary fallback={<div className="chart-error" role="alert">Failed to render price chart</div>}>
              <CandleChart
                candles={candles}
                hoverIndex={hoverIndex}
                hoverPrice={hoverPrice}
                setHoverIndex={setHoverIndex}
                setHoverPrice={setHoverPrice}
                onCrosshairScreenX={setCrosshairLineScreenX}
              />
            </ErrorBoundary>
          ) : (
            <div className="chart-placeholder">No price history is available.</div>
          )}
          <PriceAxis candles={candles} loading={loadingChart} hoverPrice={hoverPrice} symbol={selected} />
        </section>

        <section className="macd-chart" aria-label="MACD indicator">
          <div className="chart-legend-stack">
            <div className="macd-legend">
              <span>MACD 12 · 26 · 9</span>
              {active && (
                <>
                  <span className="macd-line-color">{active.macd.toFixed(4)}</span>
                  <span className="macd-signal-color">{active.macd_signal.toFixed(4)}</span>
                  <span className={active.macd_hist >= 0 ? "positive" : "negative"}>
                    {signed(active.macd_hist, "")}
                  </span>
                </>
              )}
            </div>
          </div>
          <ErrorBoundary fallback={<div className="chart-error" role="alert">Failed to render MACD chart</div>}>
            <MacdChart
              candles={candles}
              hoverIndex={hoverIndex}
              hoverValue={hoverMacd}
              setHoverIndex={setHoverIndex}
              setHoverValue={setHoverMacd}
              onCrosshairScreenX={setCrosshairLineScreenX}
            />
          </ErrorBoundary>
          <div className="empty-axis">
            {macdHover && (
              <span className="axis-tag" title="Tracking MACD" style={{ top: `${macdHover.top}%`, backgroundColor: "#5b5b66" }}>
                {macdHover.label}
              </span>
            )}
          </div>
        </section>

        <section className="rsi-chart" aria-label="RSI indicator">
          <div className="chart-legend-stack">
            <div className="rsi-legend">
              <span>RSI 14</span>
              {active && (
                <span className="rsi-line-color">{active.rsi_14?.toFixed(2) ?? "—"}</span>
              )}
            </div>
          </div>
          <ErrorBoundary fallback={<div className="chart-error" role="alert">Failed to render RSI chart</div>}>
            <RsiChart
              candles={candles}
              hoverIndex={hoverIndex}
              hoverValue={hoverRsi}
              setHoverIndex={setHoverIndex}
              setHoverValue={setHoverRsi}
              onCrosshairScreenX={setCrosshairLineScreenX}
            />
          </ErrorBoundary>
          <div className="rsi-axis">
            <span className="rsi-level rsi-current">{candles[candles.length - 1]?.rsi_14?.toFixed(2) ?? "—"}</span>
            {rsiHover && (
              <span className="axis-tag" title="Tracking RSI" style={{ top: `${rsiHover.top}%`, backgroundColor: "#5b5b66" }}>
                {rsiHover.label}
              </span>
            )}
          </div>
        </section>

        {/* Single continuous crosshair line spanning all three chart panes */}
        {crosshairLineScreenX !== null && candles.length > 0 && (
          <div
            className="crosshair-line-global"
            style={{
              position: "absolute",
              left: crosshairLineLeft,
              top: 0,
              bottom: 0,
              width: "1px",
              backgroundColor: "#5b5b66",
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}

        </div> {/* charts-wrapper */}

        <footer ref={footerRef} className="chart-footer" style={{ position: "relative" }}>
          <span>Log · Auto</span>
          {crosshairLineScreenX !== null && candles.length > 0 && (
            <span
              ref={dateLabelRef}
              className="axis-tag crosshair-tracking-date"
              style={{
                position: "absolute",
                top: "50%",
                left: dateLabelLeft,
                backgroundColor: "#5b5b66",
                transition: "left 0.12s ease-out",
              }}
            >
              {dateLabel(candles[hoverIndex ?? 0].date)}
            </span>
          )}
        </footer>
      </main>

      <AddSymbolModal
        open={showAdd}
        value={symbolInput}
        adding={adding}
        onChange={setSymbolInput}
        onSubmit={addSymbol}
        onClose={() => setShowAdd(false)}
      />

      {nameModal && (
        <WatchlistNameModal
          mode={nameModal.mode}
          initialName={nameModal.mode === "rename" ? nameModal.name : ""}
          onSubmit={(name) =>
            nameModal.mode === "create"
              ? createWatchlist(name)
              : renameWatchlist(nameModal.name, name)
          }
          onClose={closeNameModal}
        />
      )}
    </div>
  );
}
