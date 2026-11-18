"use client";

import type { MouseEvent } from "react";
import type { Candle } from "../../lib/types";
import { CHART_WIDTH, MACD_HEIGHT } from "./constants";
import { candleIndexAt, candleScreenX, macdScale, svgPoint, timeScale } from "./scale";

type MacdChartProps = {
  candles: Candle[];
  hoverIndex: number | null;
  hoverValue: number | null;
  setHoverIndex: (index: number | null) => void;
  setHoverValue: (value: number | null) => void;
  onCrosshairScreenX?: (screenX: number | null) => void;
};

export default function MacdChart({
  candles,
  hoverIndex,
  hoverValue,
  setHoverIndex,
  setHoverValue,
  onCrosshairScreenX,
}: MacdChartProps) {
  const width = CHART_WIDTH;
  const height = MACD_HEIGHT;
  const { y, valueAt, lower, upper } = macdScale(candles);
  const { x } = timeScale(candles);
  const path = (key: "macd" | "macd_signal") =>
    candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(candle[key])}`).join(" ");

  function onMouseMove(event: MouseEvent<SVGSVGElement>) {
    if (candles.length === 0) return;
    const svg = event.currentTarget;
    const point = svgPoint(svg, event.clientX, event.clientY);
    if (!point) return;
    const index = candleIndexAt(point.x, candles);
    if (index === null) return;
    setHoverIndex(index);
    setHoverValue(Math.max(lower, Math.min(upper, valueAt(point.y))));
    if (onCrosshairScreenX) onCrosshairScreenX(candleScreenX(svg, index, candles));
  }

  function onMouseLeave() {
    setHoverIndex(null);
    setHoverValue(null);
    if (onCrosshairScreenX) onCrosshairScreenX(null);
  }

  return (
    <svg className="indicator-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="MACD histogram, line, and signal" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={{ cursor: "crosshair" }}>
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
      {candles.length > 0 && hoverIndex !== null && hoverValue !== null && (
        <line x1="0" x2={width} y1={y(hoverValue)} y2={y(hoverValue)} className="crosshair-line" />
      )}
    </svg>
  );
}
