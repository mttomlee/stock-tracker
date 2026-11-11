# TDD Evidence Report — Remove button hover-only visibility

## Source plan
No `*.plan.md` was provided. User journeys were derived from the request:
"The X button is covering the price of each stock, fix it, make it only appear when hovering over the stock."

## User journeys
1. As a user, I want to see stock prices clearly without the remove (X) button covering them.
2. As a user, I want the remove button to appear only when I hover over a stock row, so I can remove stocks when needed.

## Task report

| Task | Execution summary | Validation command | Output excerpt | Guarantee |
|------|-------------------|-------------------|----------------|-----------|
| Write E2E reproducer | Created `e2e-remove-hover.test.js` checking: hidden by default, visible on hover, clickable after hover | `node e2e-remove-hover.test.js` | `FAIL: Remove button hidden by default` | RED state confirmed — button was always visible (prior change) |
| Implement CSS fix | Changed `.remove-symbol` from `display: grid` (always visible) back to `display: none` with `:hover`/`:focus-visible` showing it | `node e2e-remove-hover.test.js` | `PASS: Remove button hidden by default`<br>`PASS: Remove button visible on hover`<br>`PASS: Stock removed after clicking X` | GREEN state confirmed — all 3 checks pass |
| Verify build | `npm run build` | `npm run build` | `✓ Compiled successfully`<br>`✓ Generating static pages` | Production build compiles with no errors |
| Verify lint | `npm run lint` | `npm run lint` | Error only in removed temp test file (`no-require-imports`) | No lint errors in source code |

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Remove button is hidden by default and does not cover stock prices | `e2e-remove-hover.test.js` → `removeBtn.isHidden()` | E2E | PASS | Button resolved as hidden on page load |
| 2 | Remove button becomes visible when hovering over a stock row | `e2e-remove-hover.test.js` → `firstRow.hover()` + `removeBtn.isVisible()` | E2E | PASS | Button visible after hover, 500ms settle |
| 3 | Remove button can be clicked after hovering to remove the stock | `e2e-remove-hover.test.js` → `removeBtn.click()` + row count check | E2E | PASS | Symbol removed from watchlist after click |

## Coverage and known gaps
- Coverage tooling: Not applicable — this is a CSS-only behavioral change with no executable statements to instrument.
- The E2E test file was temporary (requires running backend + frontend servers) and has been removed. It is not committed.
- No unit test exists for CSS hover state; E2E is the appropriate validation layer for this UI behavior.

## Merge evidence
- RED: `FAIL: Remove button hidden by default` (button was always visible)
- GREEN: all 3 checks pass after CSS fix
- Refactor: none needed — CSS change is minimal (3 lines changed)
- Commits on branch `fix/e2e-issues`:
  - `77810ce` — Fix E2E issues: remove button visibility, add modal close, symbol info corruption
  - `20046c0` — Stop tracking data folder; local use only
  - `ec0787d` — Ignore data folder (local use only)
- The hover-only CSS fix will be committed next on this branch.
