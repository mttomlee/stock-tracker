# Stock Tracker — Ponytail Audit Report

**Date:** 2026-11-12  
**Auditor:** ponytail-audit skill  
**Scope:** Full repository (frontend, backend, tests, config)

---

## What this repo does

**Stock Tracker** is a stock watchlist and chart dashboard with live market data from Yahoo Finance. A Next.js 16 frontend (React 19, Tailwind CSS) runs on port 3000, and a Python FastAPI backend with yfinance runs on port 8000. The UI shows a watchlist sidebar, candlestick charts with EMA/MACD/RSI overlays, a date-range picker, and a SOXX-vs-Nasdaq cycle comparison. Data persists locally in `data/watchlist.json` (gitignored).

**Load assumed:** Single developer running locally; if deployed, a small number of concurrent users (tens, not thousands). The backend uses in-process global state and file I/O without locking, so it does not scale horizontally.

---

## Findings

### Must Fix

1. **Watchlist race condition — no locking on file I/O** (`backend/main.py:48-70, 278-287, 290-330, 333-342`)
   - **What this is:** `load_watchlist()` and `save_watchlist()` read-modify-write `watchlist.json` without any file locking.
   - **Problem:** Concurrent requests to add/remove symbols (e.g., rapid clicks) can interleave reads and writes, corrupting the file or losing updates. The global `watchlist` list at module level (line 101) is also not thread-safe.
   - **Fix:** Use a `threading.Lock` around the read-modify-write cycle, or better, switch to a lightweight embedded DB (SQLite) that handles concurrency. At minimum, add a lock in `save_watchlist` and `load_watchlist`.
   - **If we skip it:** Under concurrent use, watchlist gets corrupted or symbols disappear.

2. **No CSRF protection on mutating API endpoints** (`app/page.tsx:169-192, 194-208`)
   - **What this is:** POST `/api/watchlist/add_symbol` and DELETE `/api/watchlist` are called directly from the browser with no CSRF token.
   - **Problem:** The CORS config allows `http://localhost:3000` and `http://127.0.0.1:3000`. A malicious site visited by the user could trigger unwanted watchlist modifications via forged requests.
   - **Fix:** Add a CSRF token (double-submit cookie pattern) or require a custom header (e.g., `X-Requested-With`) that browsers won't send cross-origin without CORS preflight.
   - **If we skip it:** Cross-site request forgery can add/remove symbols silently.

3. **Bare `except Exception` swallows errors in `fetch_symbol_info`** (`backend/main.py:72-86`)
   - **What this is:** The function catches all exceptions and silently falls back to `STOCK_NAMES` or defaults.
   - **Problem:** Network errors, rate limits, yfinance API changes, or malformed responses are all hidden. The caller gets stale/incorrect name/exchange data with no indication something went wrong.
   - **Fix:** Catch specific exceptions (`yfinance` errors, `requests` errors, `KeyError`). Log the exception with `logger.warning`. Re-raise or return a structured error the caller can handle.
   - **If we skip it:** Symbol metadata silently degrades; debugging production issues becomes guesswork.

4. **No timeout on yfinance calls** (`backend/main.py:116-130`)
   - **What this is:** `_download()` calls `yf.download()` with no timeout parameter.
   - **Problem:** If Yahoo Finance is slow or unresponsive, the uvicorn worker blocks indefinitely. With the default single-worker dev setup, the entire API hangs.
   - **Fix:** Wrap the call in `asyncio.wait_for` with a 10-15 second timeout, or use `yfinance`'s `timeout` parameter if available. Return 504 on timeout.
   - **If we skip it:** One slow Yahoo request freezes the API for everyone.

5. **`addSymbol` uses `rangeIsValid` before it's defined (TDZ bug)** (`app/page.tsx:169-192, 212-213`)
   - **What this is:** The `addSymbol` function (line 169) references `rangeIsValid` at line 184, but `rangeIsValid` is declared as `const` at line 212 — later in the component body.
   - **Problem:** In JavaScript, `const` declarations are in the Temporal Dead Zone until execution reaches them. Since `addSymbol` is an `async function` (hoisted) but `rangeIsValid` is not, calling `addSymbol` before the component renders past line 212 throws `ReferenceError: Cannot access 'rangeIsValid' before initialization`.
   - **Fix:** Move `rangeIsValid` above the `addSymbol` function, or compute it inline at the call site.
   - **If we skip it:** Adding a symbol crashes the page with a console error.

6. **`_latest_quote` requires 2 data points; fails on new/thin symbols** (`backend/main.py:158-174`)
   - **What this is:** The function raises 404 if `len(frame) < 2`.
   - **Problem:** Newly listed symbols, crypto on weekends, or thinly traded tickers may only return 1 daily candle. The error message "No recent market data found" is misleading — data exists, just not enough for a change calculation.
   - **Fix:** Allow 1 data point. Compute `change` and `change_percent` as 0 when only current price exists. Return the quote with `change: 0`.
   - **If we skip it:** Valid symbols show "No recent market data" and can't be added to watchlist.

---

### Should Fix

7. **Duplicate watchlist save logic in two endpoints** (`backend/main.py:278-287, 290-330`)
   - **What this is:** `add_to_watchlist` and `add_symbol` both append to the global `watchlist`, call `save_watchlist`, and reconstruct the tickets array from scratch.
   - **Problem:** `add_symbol` was added later with `fetch_symbol_info` but copied the persistence logic. Bug fixes must be applied in two places. The older endpoint doesn't fetch live name/exchange.
   - **Fix:** Extract a private `_persist_watchlist(symbols: list[str])` helper. Deprecate `add_to_watchlist` (or make it call `add_symbol` internally).

8. **Global mutable `watchlist` state** (`backend/main.py:101`)
   - **What this is:** `watchlist = load_watchlist()` at module level creates a shared list mutated by request handlers.
   - **Problem:** Not thread-safe. Tests patch it with `patch("backend.main.watchlist", [...])` which is brittle. In a multi-worker deployment (gunicorn), each worker has its own copy — writes are not shared.
   - **Fix:** Move state into a request-scoped dependency or a simple class with a lock. For single-worker dev, a `threading.Lock` around reads/writes is the minimal fix.

9. **Chart y-scale computation duplicated in `CandleChart` and `PriceAxis`** (`app/page.tsx:458-466, 592-599`)
   - **What this is:** Both components independently compute `min`, `max`, `padding`, `lower`, `upper`, and the `y(value)` mapping.
   - **Problem:** If the computations drift (e.g., one uses `candle.low` vs `candle.high` for min), axis labels misalign with candles. The `PriceAxis` already filters labels to `lower..upper` but uses its own scale.
   - **Fix:** Create a `useChartScale(candles)` hook that returns `{ y, lower, upper, min, max }` and use it in both components.

10. **Crosshair label position measured via `getBoundingClientRect` in `useEffect` — one-frame lag** (`app/page.tsx:479-488, 228-244`)
    - **What this is:** The vertical line's screen X is measured in a `useEffect` dependent on `hoverIndex`, then passed to parent state. The parent `useEffect` (line 233) recomputes label `left` from that X.
    - **Problem:** `useEffect` runs *after* paint. When `hoverIndex` changes, the line renders at new position, then effect fires, then parent effect fires — the label lags by 1-2 frames, visible as jitter.
    - **Fix:** Measure synchronously in the `onMouseMove` handler (where `svgPoint.x` is already known) and set `crosshairLineScreenX` directly from SVG coordinates, not DOM rect. Or use a `ref` callback on the `<line>` to get the rect during render.

11. **No request timeout on yfinance calls** (`backend/main.py:116-130`)
    - Already covered in Must Fix #4.

12. **E2E test `resetWatchlist` doesn't verify final state** (`tests/e2e/watchlist.spec.ts:10-37`)
    - **What this is:** The helper removes all symbols then adds `BASELINE_SYMBOLS`. It throws on non-201/409 but doesn't confirm the watchlist actually matches baseline.
    - **Problem:** If one add fails silently (e.g., 500), the test proceeds with incomplete baseline. Subsequent tests may fail mysteriously.
    - **Fix:** After the loop, fetch `/api/watchlist` and assert the returned symbols equal `BASELINE_SYMBOLS`.

13. **E2E `chartHoverAt` uses fixed pixel offsets** (`tests/e2e/pages/WatchlistPage.ts:93-97`)
    - **What this is:** `chartHoverAt(150, 120)` assumes the chart SVG is at a specific position/size.
    - **Problem:** Layout changes (sidebar width, header height, responsive breakpoints) break the test. The chart may not even be at those coordinates.
    - **Fix:** Use the chart's bounding box to compute relative positions (e.g., 25% from left, 40% from top), or better, hover over a specific data point by finding the candle `<g>` element.

14. **Frontend price formatting duplicated in multiple places** (`app/page.tsx:79-93, 278-283, 300-305, 622-623`)
    - **What this is:** `priceLabel()` handles BTC-USD specially but is called from watch rows, header, price axis, and crosshair price label. The header also has inline formatting logic.
    - **Fix:** Ensure `priceLabel` is the single source of truth. Remove inline formatting in header (line 300-305) — it already calls `priceLabel` at line 300.

15. **No error boundary for chart components** (`app/page.tsx`)
    - **What this is:** `CandleChart`, `MacdChart`, `RsiChart` can throw (e.g., empty candles, division by zero). No React error boundary wraps them.
    - **Problem:** A single chart error crashes the entire page, including the watchlist sidebar.
    - **Fix:** Wrap each chart section in an error boundary that shows a fallback (e.g., "Chart unavailable") and logs the error.

16. **Hardcoded `STOCK_NAMES` dict with only 10 symbols** (`backend/main.py:20-31`)
    - **What this is:** Only 10 symbols have human-readable names/exchanges. Others fall back to `(symbol, "MARKET")`.
    - **Problem:** `fetch_symbol_info` tries yfinance but falls back to this dict on any error. Users adding obscure symbols get generic labels.
    - **Fix:** Remove the fallback to `STOCK_NAMES` in `fetch_symbol_info` — let yfinance be the sole source. Keep `STOCK_NAMES` only as a static override for known symbols where yfinance returns poor names.

17. **Inline SVG charts with hardcoded dimensions** (`app/page.tsx:453-455, 643-645, 692-694`)
    - **What this is:** `width=1000`, `height=330/130/170` hardcoded; `preserveAspectRatio="none"` forces stretch.
    - **Problem:** Charts don't adapt to container width. On mobile, they overflow or squash. The `viewBox` + CSS width/height pattern works, but `preserveAspectRatio="none"` distorts circles/angles.
    - **Fix:** Remove hardcoded width/height from SVG. Use `width="100%" height="100%"` with `preserveAspectRatio="xMidYMid meet"` and let CSS control size. Compute scale factors from container dimensions via `ResizeObserver`.

18. **DateRangePicker apply doesn't re-validate end date ≤ today** (`app/DateRangePicker.tsx:136-147, 158-162`)
    - **What this is:** Calendar buttons disable future dates (`value > todayIso`), but `apply()` only checks `draftStart && draftEnd && !selectingEnd`.
    - **Problem:** A user could manipulate the DOM or call `apply()` programmatically with a future `draftEnd`.
    - **Fix:** In `apply()`, assert `draftEnd <= todayIso` before calling `onApply`.

19. **Unused root files: `workflow_dispatch.sh`, `workflow_orchestrator.py`, `workflow-subagent-dispatcher.md`**
    - **What this is:** Three workflow automation files sit in the repo root.
    - **Problem:** They're development tools, not part of the application. They clutter the root and could be accidentally deployed.
    - **Fix:** Move to a `scripts/` or `docs/workflow/` folder, or delete if the `/ecc:orch-*` skills supersede them.

20. **Empty `backend/__init__.py`** (`backend/__init__.py`)
    - **What this is:** Zero-byte file.
    - **Problem:** Not needed — `backend` is not imported as a package (main.py is run directly by uvicorn). Adds noise.
    - **Fix:** Delete it.

---

### Nice to Have

21. **Consolidate `add_to_watchlist` and `add_symbol` endpoints** (`backend/main.py:278-287, 290-330`)
    - The older endpoint exists but doesn't fetch live metadata. Either remove it or make it a thin wrapper.

22. **Extract chart color constants to a shared config** (`app/page.tsx:41-46`)
    - `AVERAGES` array with colors is used in `CandleChart`, `PriceAxis`, and header legend. Moving to a separate file makes theme changes easier.

23. **Add `readonly` to `watchlist` global and use a lock** (`backend/main.py:101`)
    - Type hint `watchlist: list[str] = load_watchlist()` + `threading.Lock()` signals intent and enables static checking.

24. **Use `httpx` timeout config for yfinance calls** (if yfinance supports it) or wrap in `asyncio.wait_for`
    - See Must Fix #4.

---

## Verdict

**Healthy core, needs concurrency hardening and a few bug fixes.** The application works well for its intended single-user local use. The Must Fix items (race condition, CSRF, TDZ bug, bare except, timeout, thin-symbol handling) are all straightforward one-function fixes. The Should Fix items improve maintainability and test reliability. Lean items (root workflow files, empty `__init__.py`) are trivial cleanup.

---

## Lean

**-~50 lines, -3 root files possible.**
- Delete `backend/__init__.py` (0 lines, 1 file)
- Move/remove `workflow_dispatch.sh` (125 lines), `workflow_orchestrator.py` (155 lines), `workflow-subagent-dispatcher.md` (277 lines) from root → **-557 lines, -3 files** from repo root
- Consolidate watchlist save logic → **-~40 lines** in `main.py`
- Remove duplicate price formatting in header → **-~10 lines** in `page.tsx`

---

## Not Checked

- **Production deployment config** (no Dockerfile, no Procfile, no gunicorn config) — assumed local/dev only
- **yfinance version pinning** — `requirements.txt` has no versions; could break on yfinance API changes
- **Accessibility audit** — chart SVGs have `aria-label` but no keyboard navigation for crosshair
- **Mobile chart usability** — crosshair hover doesn't work on touch; no touch fallback tested
- **Rate limiting / abuse protection** — none on API endpoints
- **Secrets management** — no `.env.example`; `FRONTEND_ORIGINS` is the only config