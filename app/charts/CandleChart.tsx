"use client";

import type { MouseEvent } from "react";
import type { Candle } from "../../lib/types";
import { dateLabel } from "../../lib/format";
import { AVERAGES, CHART_WIDTH, PRICE_HEIGHT } from "./constants";
import { priceScale, timeScale } from "./scale";

type CandleChartProps = {
  candles: Candle[];
  hoverIndex: number | null;
  hoverPrice: number | null;
  setHoverIndex: (index: number | null) => void;
  setHoverPrice: (price: number | null) => void;
  onCrosshairScreenX?: (screenX: number | null) => void;
};

export default function CandleChart({
  candles,
  hoverIndex,
  hoverPrice,
  setHoverIndex,
  setHoverPrice,
  onCrosshairScreenX,
}: CandleChartProps) {
  const width = CHART_WIDTH;
  const height = PRICE_HEIGHT;
  const priceBottom = PRICE_HEIGHT;
  const volumeTop = 240;
  const volumeBottom = PRICE_HEIGHT;
  const { y, lower, upper } = priceScale(candles);
  const { x, candleMargin } = timeScale(candles);
  const step = width / Math.max(candles.length, 1);
  const bodyWidth = Math.max(2, Math.min(9, step * 0.56));
  const maxVolume = Math.max(...candles.map((candle) => candle.volume ?? 0), 1);
  const levels = Array.from({ length: 6 }, (_, index) => upper - ((upper - lower) * index) / 5);
  const averagePath = (key: (typeof AVERAGES)[number]["key"]) =>
    candles.map((candle, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(candle[key])}`).join(" ");

  function onMouseMove(event: MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const svgPoint = point.matrixTransform(ctm.inverse());
    const svgX = svgPoint.x;
    const svgY = svgPoint.y;

    const index = Math.round(((svgX - candleMargin) / (width - candleMargin * 2)) * (candles.length - 1));
    const clampedIndex = Math.max(0, Math.min(candles.length - 1, index));
    setHoverIndex(clampedIndex);

    const price = upper - ((svgY - 8) / (priceBottom - 12)) * (upper - lower);
    setHoverPrice(Math.max(lower, Math.min(upper, price)));

    // Report the exact screen X of the crosshair using SVG's CTM (accounts for meet scaling)
    if (onCrosshairScreenX && clampedIndex >= 0 && clampedIndex < candles.length) {
      const lineX = x(clampedIndex);
      const screenPoint = svg.createSVGPoint();
      screenPoint.x = lineX;
      screenPoint.y = 0;
      const screenCTM = svg.getScreenCTM();
      if (screenCTM) {
        const screenXY = screenPoint.matrixTransform(screenCTM);
        onCrosshairScreenX(screenXY.x);
      }
    }
  }

  function onMouseLeave() {
    setHoverIndex(null);
    setHoverPrice(null);
    if (onCrosshairScreenX) onCrosshairScreenX(null);
  }

  return (
    <svg
      className="candle-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Candlestick price chart with volume and four moving averages"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ cursor: "crosshair" }}
    >
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
      {hoverIndex !== null && hoverPrice !== null && (
        <line
          x1="0"
          x2={width}
          y1={y(hoverPrice)}
          y2={y(hoverPrice)}
          className="crosshair-line"
        />
      )}
    </svg>
  );
}
