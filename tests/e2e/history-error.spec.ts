import { test, expect, request } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';
const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

const watchlistName = `HistoryError ${Date.now()}`;

async function createWatchlistApi(name: string) {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  try {
    const response = await context.post(`${API_URL}/api/watchlists`, { data: { name } });
    if (!response.ok()) throw new Error(`Failed to create ${name}: ${response.status()}`);
  } finally {
    await context.dispose();
  }
}

async function addSymbolToWatchlistApi(name: string, symbol: string) {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  try {
    const response = await context.post(`${API_URL}/api/watchlist/add_symbol`, {
      data: { symbol, watchlist: name },
    });
    if (!response.ok()) throw new Error(`Failed to add ${symbol}: ${response.status()}`);
  } finally {
    await context.dispose();
  }
}

async function deleteWatchlistApi(name: string) {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  try {
    await context.delete(`${API_URL}/api/watchlists/${encodeURIComponent(name)}`);
  } finally {
    await context.dispose();
  }
}

test.describe('History fetch failure', () => {
  test.beforeAll(async () => {
    await createWatchlistApi(watchlistName);
    await addSymbolToWatchlistApi(watchlistName, 'TSM');
  });

  test.afterAll(async () => {
    await deleteWatchlistApi(watchlistName);
  });

  test('a failed history fetch clears the previous range chart', async ({ page }) => {
    const pageObj = new WatchlistPage(page);
    await pageObj.goto();
    await pageObj.switchWatchlist(watchlistName);
    await pageObj.waitForWatchlistLoaded();
    await expect(pageObj.chart).toBeVisible();

    // A range with no trading data (e.g. today before any bar exists) returns 404.
    await page.route('**/api/stocks/history*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'No price history found for TSM.' }),
      }),
    );

    await pageObj.openDatePicker();
    await page.locator('.date-picker-presets button').filter({ hasText: 'Past month' }).click();
    await page.locator('.date-picker-apply').click();

    await expect(pageObj.errorBanner).toBeVisible();
    await expect(pageObj.chart).toHaveCount(0);
    await expect(page.getByText('No price history is available.')).toBeVisible();
  });
});
