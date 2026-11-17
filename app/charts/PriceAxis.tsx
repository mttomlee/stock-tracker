"use client";

import type { Candle } from "../../lib/types";
import { priceLabel } from "../../lib/format";
import { AVERAGES, PRICE_HEIGHT } from "./constants";
import { priceScale } from "./scale";

export default function PriceAxis({
  candles,
  loading,
  hoverPrice,
  symbol,
}: {
  candles: Candle[];
  loading: boolean;
  hoverPrice: number | null;
  symbol: string;
}) {
  const height = PRICE_HEIGHT;
  const { y, lower, upper, priceBottom } = priceScale(candles);
  const place = (value: number) => y(value);

  if (loading || !candles.length) return <div className="price-axis" style={{ height }} />;
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
          {priceLabel(upper - ((upper - lower) * index) / 5, symbol)}
        </span>
      ))}
      {labels.map((label) => (
        <span
          className="axis-tag"
          key={label.title}
          title={label.title}
          style={{ top: `${(place(label.value) / height) * 100}%`, backgroundColor: label.color }}
        >
          {priceLabel(label.value, symbol)}
        </span>
      ))}
      {hoverPrice !== null && (
        <span
          className="axis-tag crosshair-tracking-price"
          key="tracking-price"
          title="Tracking price"
          style={{
            top: `${(place(hoverPrice) / height) * 100}%`,
            backgroundColor: "#5b5b66",
          }}
        >
          {priceLabel(hoverPrice, symbol)}
        </span>
      )}
    </div>
  );
}
