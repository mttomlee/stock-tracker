"use client";

import type { Candle } from "../../lib/types";
import { CHART_WIDTH, RSI_HEIGHT } from "./constants";
import { timeScale } from "./scale";

export default function RsiChart({ candles }: { candles: Candle[] }) {
  const width = CHART_WIDTH;
  const height = RSI_HEIGHT;
  const { x } = timeScale(candles);
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
    <svg className="indicator-svg rsi-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label="Relative strength index">
      <rect x="0" y={y(70)} width={width} height={y(30) - y(70)} fill="#6d28d9" opacity="0.09" />
      {[30, 70].map((value) => <line key={value} x1="0" x2={width} y1={y(value)} y2={y(value)} className="rsi-guide" />)}
      <path d={signalLine} fill="none" stroke="#a16207" strokeWidth="1.4" />
      <path d={line} fill="none" stroke="#6d28d9" strokeWidth="1.7" />
    </svg>
  );
}
