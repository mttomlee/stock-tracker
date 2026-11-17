export type Quote = {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  change_percent: number;
};

export type Candle = {
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

export type History = {
  symbol: string;
  range: string;
  candles: Candle[];
};

export type ChartRange = "1D" | "1W" | "1M" | "1Y";
