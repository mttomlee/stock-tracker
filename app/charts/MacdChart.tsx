"use client";

import type { Candle } from "../../lib/types";
import { CHART_WIDTH, MACD_HEIGHT } from "./constants";
import { timeScale } from "./scale";

export default function MacdChart({ candles }: { candles: Candle[] }) {
  const width = CHART_WIDTH;
  const height = MACD_HEIGHT;
  const values = candles.flatMap((candle) => [candle.macd, candle.macd_signal, candle.macd_hist]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const padding = (max - min || 1) * 0.12;
  const { x } = timeScale(candles);
  const y = (value: number) => 8 + ((max + padding - value) / (max - min + 2 * padding)) * (height - 16);
  const path = (key: "macd" | "macd_signal") =>
    candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(candle[key])}`).join(" ");

  return (
    <svg className="indicator-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="MACD histogram, line, and signal">
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
