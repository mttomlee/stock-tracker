import type { Quote } from "./types";

export function symbolLabel(symbol: string) {
  return symbol === "BTC-USD" ? "BTC/USDT" : symbol;
}

export function exchangeLabel(exchange: string) {
  return exchange === "CRYPTO" ? "BINANCE" : exchange;
}

export function nameLabel(quote: Quote) {
  return quote.symbol === "BTC-USD" ? "Bitcoin / Tether · Spot" : quote.name;
}

export function priceLabel(value: number, symbol: string, currency = false) {
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

export function dateLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function signed(value: number, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}${suffix}`;
}

export function signedPrice(value: number, symbol: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${priceLabel(Math.abs(value), symbol)}`;
}
