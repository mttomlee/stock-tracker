import { test, expect, request } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';

const API_URL = 'http://localhost:8000';

// Known baseline symbols to ensure before each test
const BASELINE_SYMBOLS = ['TSM', 'AMZN', 'GOOG', 'JPM'];

// Helper: reset watchlist to a known baseline via API
async function resetWatchlist() {
  const context = await request.newContext();

  // Get current watchlist
  const current = await context.get(`${API_URL}/api/watchlist`);
  const data = (await current.json()) as { quotes?: { symbol: string }[] };
  const symbols: string[] = data.quotes?.map((quote) => quote.symbol) ?? [];

  // Remove all current symbols (deduplicate to avoid redundant calls)
  for (const symbol of [...new Set(symbols)]) {
    await context.delete(`${API_URL}/api/watchlist`, {
      params: { symbol },
    });
  }

  // Add baseline symbols (skip if already present)
  for (const symbol of BASELINE_SYMBOLS) {
    const addRes = await context.post(`${API_URL}/api/watchlist/add_symbol`, {
      data: { symbol },
    });
    // 409 = already exists, which is fine
    if (addRes.status() !== 201 && addRes.status() !== 409) {
      throw new Error(`Failed to add ${symbol}: ${addRes.status()}`);
    }
  }

  await context.dispose();
}

test.describe('Watchlist & Chart E2E', () => {
  let pageObj: WatchlistPage;

  test.beforeEach(async ({ page }) => {
    // Ensure known backend state before each test
    await resetWatchlist();

    pageObj = new WatchlistPage(page);
    await pageObj.goto();
    await pageObj.waitForWatchlistLoaded();
  });

  test('loads watchlist with symbols and displays chart', async ({ page }) => {
    // Watchlist should have baseline symbols
    const count = await pageObj.getRowCount();
    expect(count).toBeGreaterThan(0);

    // Should not still be loading
    await expect(pageObj.watchlist.locator('.sidebar-message')).toHaveCount(0);

    // Default symbol selected and chart visible
    await expect(pageObj.selectedSymbolHeading).toBeVisible();
    await expect(pageObj.chart).toBeVisible();
  });

  test('remove button is hidden by default and appears on hover', async ({ page }) => {
    const firstRow = pageObj.watchRows.first();
    const removeBtn = firstRow.locator('.remove-symbol');

    // Hidden by default — does not cover price
    await expect(removeBtn).toBeHidden();

    // Visible on hover
    await firstRow.hover();
    await expect(removeBtn).toBeVisible();
  });

  test('can remove a stock symbol via the X button', async ({ page }) => {
    const countBefore = await pageObj.getRowCount();
    const firstRow = pageObj.watchRows.first();
    const symbol = (await firstRow.locator('.watch-row-identity b').textContent())?.trim() ?? '';

    // Hover reveals remove button, then click it
    await firstRow.hover();
    const removeBtn = firstRow.locator('.remove-symbol');
    await removeBtn.waitFor({ state: 'visible' });
    await removeBtn.click({ force: true });

    // Symbol removed
    await expect(pageObj.getRowBySymbol(symbol)).toHaveCount(0);
    expect(await pageObj.getRowCount()).toBe(countBefore - 1);
  });

  test('can add a new symbol and switch to it', async ({ page }) => {
    const countBefore = await pageObj.getRowCount();
    const newSymbol = 'MSFT';

    await pageObj.addSymbol(newSymbol);

    // Modal closed after submit
    await expect(pageObj.addModal).toBeHidden();

    // New symbol added to watchlist
    await expect(pageObj.getRowBySymbol(newSymbol).first()).toBeVisible();

    // Price is fetched and shown, not zero
    const priceText = await pageObj.getRowPrice(newSymbol).first().textContent();
    const price = Number((priceText ?? '').replace(/[$,]/g, ''));
    expect(price).toBeGreaterThan(0);

    // Count increased
    await expect.poll(
      async () => {
        return await pageObj.getRowCount();
      },
      { timeout: 5000 },
    ).toBe(countBefore + 1);

    // Switch to new symbol and chart updates
    await pageObj.clickRow(newSymbol);
    await expect(pageObj.selectedSymbolHeading).toHaveText(newSymbol);
    await expect(pageObj.chart).toBeVisible();

    // Clean up: remove the symbol we added
    await pageObj.removeSymbol(newSymbol);
  });

  test('duplicate add shows error but closes modal', async ({ page }) => {
    const countBefore = await pageObj.getRowCount();

    // Pick a symbol already on the watchlist
    const firstSymbolText =
      (await pageObj.watchRows
        .first()
        .locator('.watch-row-identity b')
        .textContent())?.trim() ?? '';

    await pageObj.addSymbol(firstSymbolText);

    // Modal closed even on error
    await expect(pageObj.addModal).toBeHidden();

    // Error banner shown
    await expect(pageObj.errorBanner).toBeVisible();

    // Watchlist unchanged
    const countAfter = await pageObj.getRowCount();
    expect(countAfter).toBe(countBefore);
  });

  test('date range picker opens and closes', async ({ page }) => {
    await pageObj.openDatePicker();
    await expect(pageObj.datePickerPopover).toBeVisible();

    await pageObj.closeDatePicker();
    await expect(pageObj.datePickerPopover).toBeHidden();
  });

  test('switching symbols updates chart', async ({ page }) => {
    const symbols = BASELINE_SYMBOLS;
    for (const symbol of symbols) {
      const rowCount = await pageObj.getRowBySymbol(symbol).count();
      if (rowCount === 0) continue;

      await pageObj.clickRow(symbol);
      await expect(pageObj.selectedSymbolHeading).toHaveText(symbol);
      await expect(pageObj.chart).toBeVisible();
      break; // Test first available symbol
    }
  });

  test('chart crosshair tracks the pointer with price and date labels', async () => {
    await expect(pageObj.chart).toBeVisible();

    // No crosshair labels before hovering
    await expect(pageObj.crosshairPriceLabel).toBeHidden();
    await expect(pageObj.crosshairDateLabel).toBeHidden();

    // Hover over the chart: crosshair labels appear
    await pageObj.chartHoverAt(150, 120);
    await expect(pageObj.crosshairPriceLabel).toBeVisible();
    await expect(pageObj.crosshairDateLabel).toBeVisible();

    // Move horizontally: the date label follows the candle under the pointer
    const firstDate = (await pageObj.crosshairDateLabel.textContent())?.trim();
    await pageObj.chartHoverAt(450, 120);
    const secondDate = (await pageObj.crosshairDateLabel.textContent())?.trim();
    expect(secondDate).toBeTruthy();
    expect(secondDate).not.toBe(firstDate);

    // Move off the chart: crosshair labels hide again
    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairPriceLabel).toBeHidden();
    await expect(pageObj.crosshairDateLabel).toBeHidden();
  });
});
