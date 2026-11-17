import type { Candle } from "../../lib/types";
import { CHART_WIDTH, PRICE_HEIGHT } from "./constants";

export function priceScale(candles: Candle[]) {
  const min = Math.min(...candles.map((candle) => candle.low));
  const max = Math.max(...candles.map((candle) => candle.high));
  const padding = (max - min || max * 0.02) * 0.08;
  const lower = min - padding;
  const upper = max + padding;
  const priceBottom = PRICE_HEIGHT;
  const y = (value: number) => 8 + ((upper - value) / (upper - lower)) * (priceBottom - 12);
  return { y, lower, upper, priceBottom };
}

// Shared x-scale — all three charts use identical horizontal mapping so the
// crosshair line appears as one continuous vertical line across panes.
export function timeScale(candles: Candle[]) {
  const width = CHART_WIDTH;
  const candleMargin = 8;
  const x = (index: number) =>
    candleMargin + (index / Math.max(candles.length - 1, 1)) * (width - candleMargin * 2);
  return { x, candleMargin };
}
