"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import DateRangePicker from "./DateRangePicker";
import ErrorBoundary from "./ErrorBoundary";
import Watchlist from "./Watchlist";
import AddSymbolModal from "./AddSymbolModal";
import CandleChart from "./charts/CandleChart";
import PriceAxis from "./charts/PriceAxis";
import MacdChart from "./charts/MacdChart";
import RsiChart from "./charts/RsiChart";
import { AVERAGES } from "./charts/constants";
import { request } from "../lib/api";
import { dateLabel, exchangeLabel, priceLabel, signed, symbolLabel } from "../lib/format";
import type { ChartRange, History, Quote } from "../lib/types";

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState("TSM");
  const range: ChartRange = "1W";
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [error, setError] = useState("");
  const dateLabelRef = useRef<HTMLSpanElement>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    request<{ quotes: Quote[] }>("/api/watchlist", { signal: controller.signal })
      .then(({ quotes: nextQuotes }) => {
        setQuotes(nextQuotes);
        setSelected((current) =>
          nextQuotes.some((quote) => quote.symbol === current)
            ? current
            : (nextQuotes[0]?.symbol ?? ""),
        );
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(`Could not load watchlist: ${reason.message}`);
      })
      .finally(() => setLoadingQuotes(false));
    return () => controller.abort();
  }, []);

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
        if (reason.name !== "AbortError") setError(`Could not load chart: ${reason.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingChart(false);
      });
    return () => controller.abort();
  }, [endDate, range, selected, startDate]);

  const rangeIsValid =
    !(startDate || endDate) || Boolean(startDate && endDate && startDate <= endDate);

  async function addSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setAdding(true);
    setError("");
    try {
      const result = await request<{ quote: Quote }>("/api/watchlist/add_symbol", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ symbol }),
      });
      const quote: Quote = result.quote;
      setQuotes((current) => [...current, quote]);
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
      await request(`/api/watchlist?${new URLSearchParams({ symbol })}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const remaining = quotes.filter((quote) => quote.symbol !== symbol);
      setQuotes(remaining);
      if (selected === symbol) {
        setSelected(remaining[0]?.symbol ?? "");
        setLoadingChart(remaining.length > 0 && rangeIsValid);
        if (remaining.length === 0) setHistory(null);
      }
    } catch (reason) {
      setError(`Could not remove ${symbol}: ${(reason as Error).message}`);
    }
  }

  function selectSymbol(symbol: string) {
    if (selected === symbol) return;
    setSelected(symbol);
    setLoadingChart(rangeIsValid);
  }

  const activeQuote = quotes.find((quote) => quote.symbol === selected);
  const candles = history?.symbol === selected ? history.candles : [];
  const visibleError =
    startDate && endDate && startDate > endDate
      ? "Start date must be on or before end date."
      : error;
  const defaultStart = candles[0]?.date.slice(0, 10) ?? "";
  const defaultEnd = candles[candles.length - 1]?.date.slice(0, 10) ?? "";

  // Crosshair position in screen coordinates, reported directly by CandleChart via SVG CTM
  const [crosshairLineScreenX, setCrosshairLineScreenX] = useState<number | null>(null);
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
        onSelect={selectSymbol}
        onRemove={removeSymbol}
        onShowAdd={() => setShowAdd(true)}
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
          <div className="main-indicator-legend">
            <span>EMA <b>9</b> · <b>21</b> · <b>50</b> · <b>200</b></span>
            {candles.length > 0 && AVERAGES.map(({ key, label, color }) => (
              <span key={key} style={{ color }} aria-label={label}>
                {priceLabel(candles[candles.length - 1][key], selected)}
              </span>
            ))}
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
          <div className="pane-heading">
            <b>MACD</b> 12 26 9
            {candles.length > 0 && (
              <>
                <span className="macd-line-color">{candles[candles.length - 1].macd.toFixed(4)}</span>
                <span className="macd-signal-color">{candles[candles.length - 1].macd_signal.toFixed(4)}</span>
                <span className={candles[candles.length - 1].macd_hist >= 0 ? "positive" : "negative"}>
                  {signed(candles[candles.length - 1].macd_hist, "")}
                </span>
              </>
            )}
          </div>
          <ErrorBoundary fallback={<div className="chart-error" role="alert">Failed to render MACD chart</div>}>
            <MacdChart candles={candles} />
          </ErrorBoundary>
          <div className="empty-axis" />
        </section>

        <section className="rsi-chart" aria-label="RSI indicator">
          <div className="pane-heading">
            <b>RSI</b> 14
            {candles.length > 0 && (
              <>
                <span className="rsi-line-color">{candles[candles.length - 1].rsi_14?.toFixed(2) ?? "—"}</span>
                <span className="rsi-signal-color">{candles.length > 1 ? candles[candles.length - 2].rsi_14?.toFixed(2) ?? "—" : "—"}</span>
              </>
            )}
          </div>
          <ErrorBoundary fallback={<div className="chart-error" role="alert">Failed to render RSI chart</div>}>
            <RsiChart candles={candles} />
          </ErrorBoundary>
          <div className="rsi-axis">
            <span className="rsi-level rsi-current">{candles[candles.length - 1]?.rsi_14?.toFixed(2) ?? "—"}</span>
            <span className="rsi-level rsi-average">{candles.length > 1 ? candles[candles.length - 2]?.rsi_14?.toFixed(2) ?? "—" : "—"}</span>
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
    </div>
  );
}
