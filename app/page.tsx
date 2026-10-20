"use client";

import { FormEvent, useEffect, useState } from "react";
import DateRangePicker from "./DateRangePicker";

type Quote = {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  change_percent: number;
};

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  ema_9: number;
  ema_21: number;
  ema_50: number;
  ema_200: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  rsi_14: number | null;
};

type History = {
  symbol: string;
  range: string;
  candles: Candle[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
type ChartRange = "1D" | "1W" | "1M" | "1Y";

const AVERAGES = [
  { key: "ema_9", label: "EMA 9", color: "#0b7f73" },
  { key: "ema_21", label: "EMA 21", color: "#c2410c" },
  { key: "ema_50", label: "EMA 50", color: "#8a6a00" },
  { key: "ema_200", label: "EMA 200", color: "#be123c" },
] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  const body = await response.text();
  if (!response.ok) {
    let message = body || response.statusText;
    try {
      message = JSON.parse(body).detail ?? message;
    } catch {
      // Keep the response text when the server did not return JSON.
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("The API returned an invalid response.");
  }
}

function symbolLabel(symbol: string) {
  return symbol === "BTC-USD" ? "BTC/USDT" : symbol;
}

function exchangeLabel(exchange: string) {
  return exchange === "CRYPTO" ? "BINANCE" : exchange;
}

function nameLabel(quote: Quote) {
  return quote.symbol === "BTC-USD" ? "Bitcoin / Tether · Spot" : quote.name;
}

function priceLabel(value: number, symbol: string, currency = false) {
  if (symbol === "BTC-USD") {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (!currency) return value.toFixed(2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function signed(value: number, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}${suffix}`;
}

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState("TSM");
  const range: ChartRange = "1W";
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [error, setError] = useState("");
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

  async function addSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setAdding(true);
    setError("");
    try {
      const result = await request<{ symbol: string; name: string; exchange: string }>("/api/watchlist/add_symbol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const quote: Quote = {
        symbol: result.symbol,
        name: result.name,
        exchange: result.exchange,
        price: 0,
        change: 0,
        change_percent: 0,
      };
      setQuotes((current) => [...current, quote]);
      setSelected(result.symbol);
      setLoadingChart(rangeIsValid);
      setSymbolInput("");
      setShowAdd(false);
    } catch (reason) {
      setError(`Could not add ${symbol}: ${(reason as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function removeSymbol(symbol: string) {
    setError("");
    try {
      await request(`/api/watchlist?${new URLSearchParams({ symbol })}`, { method: "DELETE" });
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

  const activeQuote = quotes.find((quote) => quote.symbol === selected);
  const candles = history?.symbol === selected ? history.candles : [];
  const rangeIsValid =
    !(startDate || endDate) || Boolean(startDate && endDate && startDate <= endDate);
  const visibleError =
    startDate && endDate && startDate > endDate
      ? "Start date must be on or before end date."
      : error;
  const defaultStart = candles[0]?.date.slice(0, 10) ?? "";
  const defaultEnd = candles[candles.length - 1]?.date.slice(0, 10) ?? "";

  return (
    <div className="app">
      <aside className="side">
        <div className="watchlist-heading">
          <h1>My watchlist</h1>
          <span>{quotes.length} symbols</span>
        </div>
        <div className="watchlist-actions">
          <button className="add-symbol" onClick={() => setShowAdd(true)}>+ Add symbol</button>
          <button className="add-alert" type="button" title="Price alerts are not available yet">+ Add alert</button>
        </div>
        <div className="watchlist" aria-label="Watchlist">
          {loadingQuotes && quotes.length === 0 ? (
            <div className="sidebar-message">Loading watchlist…</div>
          ) : quotes.length === 0 ? (
            <div className="sidebar-message">Your watchlist is empty.</div>
          ) : (
            quotes.map((quote) => (
              <div className={`watch-row-wrap ${selected === quote.symbol ? "selected" : ""}`} key={quote.symbol}>
                <button className="watch-row" onClick={() => {
                  if (selected !== quote.symbol) {
                    setSelected(quote.symbol);
                    setLoadingChart(rangeIsValid);
                  }
                }}>
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
                <button className="remove-symbol" aria-label={`Remove ${symbolLabel(quote.symbol)}`} onClick={() => void removeSymbol(quote.symbol)}>×</button>
              </div>
            ))
          )}
        </div>
      </aside>

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
            <CandleChart candles={candles} />
          ) : (
            <div className="chart-placeholder">No price history is available.</div>
          )}
          <PriceAxis candles={candles} loading={loadingChart} />
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
          <MacdChart candles={candles} />
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
          <RsiChart candles={candles} />
          <div className="rsi-axis">
            <span className="rsi-level rsi-current">{candles[candles.length - 1]?.rsi_14?.toFixed(2) ?? "—"}</span>
            <span className="rsi-level rsi-average">{candles.length > 1 ? candles[candles.length - 2]?.rsi_14?.toFixed(2) ?? "—" : "—"}</span>
          </div>
        </section>

        <footer className="chart-footer">
          <span>{footerDate(candles)}</span>
          <span>17:18 NY · Log · Auto</span>
        </footer>
      </main>

      {showAdd && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowAdd(false);
        }}>
          <form className="add-modal" onSubmit={addSymbol}>
            <button className="modal-close" type="button" onClick={() => setShowAdd(false)} aria-label="Close">×</button>
            <h2>Add symbol</h2>
            <p>Enter a ticker symbol to add it to your watchlist.</p>
            <label htmlFor="symbol-input">Symbol</label>
            <input
              id="symbol-input"
              autoFocus
              maxLength={20}
              placeholder="e.g. MSFT"
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
            />
            <button className="submit-button" type="submit" disabled={adding || !symbolInput.trim()}>
              {adding ? "Adding…" : "Add symbol"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function footerDate(candles: Candle[]) {
  if (!candles.length) return "—";
  const first = new Date(candles[0].date);
  const last = new Date(candles[candles.length - 1].date);
  return `${first.toLocaleDateString("en-US", { month: "short" }).toUpperCase()} · ${last.getFullYear()} · ${last.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}`;
}

function CandleChart({ candles }: { candles: Candle[] }) {
  const width = 1000;
  const height = 330;
  const priceBottom = 330;
  const volumeTop = 240;
  const volumeBottom = 330;
  const min = Math.min(...candles.map((candle) => candle.low));
  const max = Math.max(...candles.map((candle) => candle.high));
  const padding = (max - min || max * 0.02) * 0.08;
  const lower = min - padding;
  const upper = max + padding;
  const x = (index: number) => (index / Math.max(candles.length - 1, 1)) * (width - 4) + 2;
  const y = (value: number) => 8 + ((upper - value) / (upper - lower)) * (priceBottom - 12);
  const step = width / Math.max(candles.length, 1);
  const bodyWidth = Math.max(2, Math.min(9, step * 0.56));
  const maxVolume = Math.max(...candles.map((candle) => candle.volume ?? 0), 1);
  const levels = Array.from({ length: 6 }, (_, index) => upper - ((upper - lower) * index) / 5);
  const averagePath = (key: (typeof AVERAGES)[number]["key"]) =>
    candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(candle[key])}`).join(" ");

  return (
    <svg className="candle-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Candlestick price chart with volume and four moving averages">
      {levels.map((value, index) => (
        <g key={`level-${index}`}>
          <line x1="0" x2={width} y1={y(value)} y2={y(value)} className="chart-grid" />
        </g>
      ))}
      {candles.map((candle, index) => {
        const rising = candle.close >= candle.open;
        const color = rising ? "#2a9d8f" : "#e63946";
        const bodyTop = y(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(1.4, Math.abs(y(candle.open) - y(candle.close)));
        const volumeHeight = ((candle.volume ?? 0) / maxVolume) * (volumeBottom - volumeTop);
        return (
          <g key={`${candle.date}-${index}`}>
            <title>{`${dateLabel(candle.date)} · O ${candle.open.toFixed(2)} · H ${candle.high.toFixed(2)} · L ${candle.low.toFixed(2)} · C ${candle.close.toFixed(2)}`}</title>
            <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1" />
            <rect x={x(index) - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
            <rect
              x={x(index) - Math.max(2, bodyWidth * 0.65)}
              y={volumeBottom - volumeHeight}
              width={Math.max(4, bodyWidth * 1.3)}
              height={volumeHeight}
              fill={color}
              opacity="0.2"
            />
          </g>
        );
      })}
      {AVERAGES.map(({ key, color }) => (
        <path key={key} d={averagePath(key)} fill="none" stroke={color} strokeWidth="1.25" />
      ))}
      {candles.length > 1 && (
        <line
          x1="0"
          x2={width}
          y1={y(candles[candles.length - 1].close)}
          y2={y(candles[candles.length - 1].close)}
          stroke="#5b5b66"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

function PriceAxis({ candles, loading }: { candles: Candle[]; loading: boolean }) {
  if (loading || !candles.length) return <div className="price-axis" />;
  const height = 330;
  const priceBottom = 255;
  const min = Math.min(...candles.map((candle) => candle.low));
  const max = Math.max(...candles.map((candle) => candle.high));
  const padding = (max - min || max * 0.02) * 0.08;
  const lower = min - padding;
  const upper = max + padding;
  const place = (value: number) => 8 + ((upper - value) / (upper - lower)) * (priceBottom - 12);
  const labels = [
    ...AVERAGES.map((average) => ({
      value: candles[candles.length - 1][average.key],
      color: average.color,
      title: average.label,
    })),
    { value: candles[candles.length - 1].close, color: "#5b5b66", title: "Last price" },
  ].filter((label) => label.value >= lower && label.value <= upper);

  return (
    <div className="price-axis" style={{ height }}>
      {Array.from({ length: 6 }, (_, index) => (
        <span className="axis-value" key={index} style={{ top: `${(index / 5) * (priceBottom / height) * 100}%` }}>
          {(upper - ((upper - lower) * index) / 5).toFixed(2)}
        </span>
      ))}
      {labels.map((label) => (
        <span
          className="axis-tag"
          key={label.title}
          title={label.title}
          style={{ top: `${(place(label.value) / height) * 100}%`, backgroundColor: label.color }}
        >
          {label.value.toFixed(2)}
        </span>
      ))}
    </div>
  );
}

function MacdChart({ candles }: { candles: Candle[] }) {
  const width = 1000;
  const height = 130;
  const paddingX = 2;
  const values = candles.flatMap((candle) => [candle.macd, candle.macd_signal, candle.macd_hist]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const padding = (max - min || 1) * 0.12;
  const x = (index: number) => paddingX + (index / Math.max(candles.length - 1, 1)) * (width - paddingX * 2);
  const y = (value: number) => 8 + ((max + padding - value) / (max - min + 2 * padding)) * (height - 16);
  const path = (key: "macd" | "macd_signal") =>
    candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(candle[key])}`).join(" ");

  return (
    <svg className="indicator-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="MACD histogram, line, and signal">
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="indicator-grid" />
      {candles.map((candle, index) => {
        const positive = candle.macd_hist >= 0;
        const top = y(Math.max(candle.macd_hist, 0));
        const bottom = y(Math.min(candle.macd_hist, 0));
        const barWidth = Math.max(3, (width / candles.length) * 0.58);
        return (
          <rect
            key={`${candle.date}-${index}`}
            x={x(index) - barWidth / 2}
            y={top}
            width={barWidth}
            height={Math.max(1, bottom - top)}
            fill={positive ? "#2a9d8f" : "#e63946"}
            opacity="0.62"
          />
        );
      })}
      <path d={path("macd")} fill="none" stroke="#1d6fe0" strokeWidth="1.7" />
      <path d={path("macd_signal")} fill="none" stroke="#be123c" strokeWidth="1.5" />
    </svg>
  );
}

function RsiChart({ candles }: { candles: Candle[] }) {
  const width = 1000;
  const height = 170;
  const x = (index: number) => (index / Math.max(candles.length - 1, 1)) * width;
  const y = (value: number) => 8 + ((100 - value) / 100) * (height - 16);
  const points = candles
    .map((candle, index) => candle.rsi_14 === null ? null : [index, candle.rsi_14] as const)
    .filter((point): point is readonly [number, number] => point !== null);
  const line = points.map(([index, value], point) => `${point === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
  const signal = points.map(([index, value], point) => {
    const previous = points[Math.max(0, point - 1)][1];
    const next = points[Math.min(points.length - 1, point + 1)][1];
    return [index, (previous + value + next) / 3] as const;
  });
  const signalLine = signal.map(([index, value], point) => `${point === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");

  return (
    <svg className="indicator-svg rsi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Relative strength index">
      <rect x="0" y={y(70)} width={width} height={y(30) - y(70)} fill="#6d28d9" opacity="0.09" />
      {[30, 70].map((value) => <line key={value} x1="0" x2={width} y1={y(value)} y2={y(value)} className="rsi-guide" />)}
      <path d={signalLine} fill="none" stroke="#a16207" strokeWidth="1.4" />
      <path d={line} fill="none" stroke="#6d28d9" strokeWidth="1.7" />
    </svg>
  );
}
