# Stock Tracker

Watchlists and technical charts for stocks, in one place. A Next.js front end backed by a small FastAPI service that pulls quotes and OHLC history from Yahoo Finance.

## Features

- **Named watchlists** — create, rename, and delete lists; add and remove symbols.
- **Live quote table** — price, change, and percent change per symbol.
- **Candlestick charts** — OHLC candles with a date-range picker, including custom ranges.
- **EMA overlays** — 9/21/50/200 exponential moving averages over the price chart.
- **RSI and MACD panes** — aligned to the same time axis as the price chart.
- **SOXX vs Nasdaq comparison** — the semis ETF plotted against the dot-com-era Nasdaq.
- **Responsive layout** — works from a 375 px phone viewport up to wide desktop.

## Stack

| Layer | Tech |
|-------|------|
| Front end | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4 |
| Backend | FastAPI, Uvicorn, yfinance |
| Tests | Playwright (E2E), Python `unittest` (backend) |
| CI | GitHub Actions — `.github/workflows/e2e.yml` |

## Getting started

**Prerequisites:** Node.js 20+, Python 3.10+.

1. Install the web dependencies:

   ```powershell
   npm install
   ```

2. Install the Python backend dependencies:

   ```powershell
   python -m pip install -r backend\requirements.txt
   ```

3. Start both servers together:

   ```powershell
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000). The API runs on [http://localhost:8000](http://localhost:8000), with interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs). Press Ctrl+C to stop both servers.

`npm run dev` starts both with `concurrently --kill-others`, so stopping either server stops both.

## How it works

- The Next.js app talks to the FastAPI service through `lib/api.ts`. The browser never calls Yahoo Finance directly.
- For each history request the backend downloads 10 years of daily history before the requested start, computes EMA, RSI, and MACD on that full frame, then slices the visible range. Indicators therefore already have their history when a chart first renders.
- Indicators and candles share one horizontal scale across panes, which keeps crosshairs and axis labels aligned.
- Watchlists are persisted by the API to `data/watchlist.json`, which is created on first save and is not tracked by git.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/watchlists` | List all named watchlists |
| `POST` | `/api/watchlists` | Create a watchlist |
| `PATCH` | `/api/watchlists/{name}` | Rename a watchlist |
| `DELETE` | `/api/watchlists/{name}` | Delete a watchlist |
| `GET` | `/api/watchlist` | Read the symbols of a watchlist (defaults to the first) |
| `POST` | `/api/watchlist` | Add a symbol (legacy alias of `add_symbol`) |
| `POST` | `/api/watchlist/add_symbol` | Add a symbol to a watchlist |
| `DELETE` | `/api/watchlist` | Remove a symbol from a watchlist |
| `GET` | `/api/stocks/history` | OHLC series with EMA, RSI, and MACD |
| `GET` | `/api/comparison/soxx-dotcom` | SOXX vs Nasdaq comparison series |

Mutating requests (`POST`, `PATCH`, `DELETE`) must send `X-Requested-With: XMLHttpRequest`; the API rejects them with `403` otherwise.

## Testing

```powershell
# Backend unit tests
python -m unittest backend.test_main

# End-to-end tests (needs the API on 8000 and the app on 3000)
npx playwright test

# Lint
npm run lint
```

CI builds the app, serves it on port 3002, and runs the same Playwright suite against it; the Playwright `baseURL` comes from the `BASE_URL` environment variable.

## Project layout

```text
app/                 Next.js app router pages and UI components
  charts/            Candle, EMA, RSI, and MACD chart panes
backend/             FastAPI service, Yahoo Finance client, watchlist store
lib/                 API client, formatters, shared types
tests/e2e/           Playwright specs and page objects
public/              Static assets and fonts
data/                Local watchlist storage (gitignored)
```

## Notes

- Yahoo Finance is an unofficial data source: quotes can be delayed, and requests can fail or come back empty. The UI surfaces load errors rather than showing stale numbers.
- The portfolio-comparison and chart features are research tools, not investment advice.
- `data/` and `.playwright-mcp/` are local-only; keep them out of commits.
