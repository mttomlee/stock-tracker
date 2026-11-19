"use client";

import type { MouseEvent } from "react";
import type { Candle } from "../../lib/types";
import { CHART_WIDTH, RSI_HEIGHT } from "./constants";
import { candleIndexAt, candleScreenX, rsiScale, svgPoint, timeScale } from "./scale";

type RsiChartProps = {
  candles: Candle[];
  hoverIndex: number | null;
  hoverValue: number | null;
  setHoverIndex: (index: number | null) => void;
  setHoverValue: (value: number | null) => void;
  onCrosshairScreenX?: (screenX: number | null) => void;
};

export default function RsiChart({
  candles,
  hoverIndex,
  hoverValue,
  setHoverIndex,
  setHoverValue,
  onCrosshairScreenX,
}: RsiChartProps) {
  const width = CHART_WIDTH;
  const height = RSI_HEIGHT;
  const { x } = timeScale(candles);
  const { y, valueAt } = rsiScale();

  function onMouseMove(event: MouseEvent<SVGSVGElement>) {
    if (candles.length === 0) return;
    const svg = event.currentTarget;
    const point = svgPoint(svg, event.clientX, event.clientY);
    if (!point) return;
    const index = candleIndexAt(point.x, candles);
    if (index === null) return;
    setHoverIndex(index);
    setHoverValue(Math.max(0, Math.min(100, valueAt(point.y))));
    if (onCrosshairScreenX) onCrosshairScreenX(candleScreenX(svg, index, candles));
  }

  function onMouseLeave() {
    setHoverIndex(null);
    setHoverValue(null);
    if (onCrosshairScreenX) onCrosshairScreenX(null);
  }
  const points = candles
    .map((candle, index) => candle.rsi_14 === null ? null : [index, candle.rsi_14] as const)
    .filter((point): point is readonly [number, number] => point !== null);
  const line = points.map(([index, value], point) => `${point === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");

  return (
    <svg className="indicator-svg rsi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="Relative strength index" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={{ cursor: "crosshair" }}>
      <rect x="0" y={y(70)} width={width} height={y(30) - y(70)} fill="#6d28d9" opacity="0.09" />
      {[30, 70].map((value) => <line key={value} x1="0" x2={width} y1={y(value)} y2={y(value)} className="rsi-guide" />)}
      <path d={line} fill="none" stroke="#6d28d9" strokeWidth="1.7" />
      {candles.length > 0 && hoverIndex !== null && hoverValue !== null && (
        <line x1="0" x2={width} y1={y(hoverValue)} y2={y(hoverValue)} className="crosshair-line" />
      )}
    </svg>
  );
}
