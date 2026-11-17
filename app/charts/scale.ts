import type { Candle } from "../../lib/types";
import { CHART_WIDTH, MACD_HEIGHT, PRICE_HEIGHT, RSI_HEIGHT } from "./constants";

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

export function macdScale(candles: Candle[]) {
  const values = candles.flatMap((candle) => [candle.macd, candle.macd_signal, candle.macd_hist]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const padding = (max - min || 1) * 0.12;
  const lower = min - padding;
  const upper = max + padding;
  const y = (value: number) => 8 + ((upper - value) / (upper - lower)) * (MACD_HEIGHT - 16);
  const valueAt = (svgY: number) => upper - ((svgY - 8) / (MACD_HEIGHT - 16)) * (upper - lower);
  return { y, valueAt, lower, upper };
}

export function rsiScale() {
  const y = (value: number) => 8 + ((100 - value) / 100) * (RSI_HEIGHT - 16);
  const valueAt = (svgY: number) => 100 - ((svgY - 8) / (RSI_HEIGHT - 16)) * 100;
  return { y, valueAt };
}

// Map a pointer event to viewBox coordinates; the SVG is stretched (preserveAspectRatio="none").
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm || !ctm.a || !ctm.d) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const { x, y } = point.matrixTransform(ctm.inverse());
  return { x, y };
}

// Pointer viewBox X → the candle index under it, clamped to the series.
// No series has no candles under the pointer, so the result is null, not 0.
export function candleIndexAt(svgX: number, candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  const { candleMargin } = timeScale(candles);
  const index = Math.round(
    ((svgX - candleMargin) / (CHART_WIDTH - candleMargin * 2)) * (candles.length - 1),
  );
  return Math.max(0, Math.min(candles.length - 1, index));
}

// Screen X of a candle index, via the SVG's CTM (accounts for pane scaling).
export function candleScreenX(svg: SVGSVGElement, index: number, candles: Candle[]) {
  const ctm = svg.getScreenCTM();
  if (!ctm || !ctm.a || !ctm.d) return null;
  const point = svg.createSVGPoint();
  point.x = timeScale(candles).x(index);
  point.y = 0;
  return point.matrixTransform(ctm).x;
}
