import { test, expect, request } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';
const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

// Known baseline symbols to ensure before each test
const BASELINE_SYMBOLS = ['TSM', 'AMZN', 'GOOG', 'JPM'];

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}`;
}

async function createWatchlistApi(name: string) {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  try {
    const response = await context.post(`${API_URL}/api/watchlists`, { data: { name } });
    if (!response.ok()) throw new Error(`Failed to create ${name}: ${response.status()}`);
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

// Helper: reset the first (initially active) watchlist to a known baseline via API
async function resetWatchlist(): Promise<string> {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  let target = '';

  try {
    const listsResponse = await context.get(`${API_URL}/api/watchlists`);
    const lists = ((await listsResponse.json()) as { watchlists?: { name: string }[] }).watchlists ?? [];
    target = lists[0]?.name ?? '';
    if (!target) throw new Error('No watchlist exists to reset');

    // Get current watchlist
    const current = await context.get(`${API_URL}/api/watchlist`, {
      params: { watchlist: target },
    });
    const data = (await current.json()) as { quotes?: { symbol: string }[] };
    const symbols: string[] = data.quotes?.map((quote) => quote.symbol) ?? [];

    // Remove all current symbols (deduplicate to avoid redundant calls)
    for (const symbol of [...new Set(symbols)]) {
      await context.delete(`${API_URL}/api/watchlist`, {
        params: { symbol, watchlist: target },
      });
    }

    // Add baseline symbols (skip if already present)
    for (const symbol of BASELINE_SYMBOLS) {
      const addRes = await context.post(`${API_URL}/api/watchlist/add_symbol`, {
        data: { symbol, watchlist: target },
      });
      // 409 = already exists, which is fine
      if (addRes.status() !== 201 && addRes.status() !== 409) {
        throw new Error(`Failed to add ${symbol}: ${addRes.status()}`);
      }
    }

    // Verify the watchlist matches BASELINE_SYMBOLS
    const verify = await context.get(`${API_URL}/api/watchlist`, {
      params: { watchlist: target },
    });
    const verifyData = (await verify.json()) as { quotes?: { symbol: string }[] };
    const verifySymbols = verifyData.quotes?.map((quote) => quote.symbol) ?? [];
    const sortedBaseline = [...BASELINE_SYMBOLS].sort();
    const sortedVerify = [...verifySymbols].sort();
    if (JSON.stringify(sortedVerify) !== JSON.stringify(sortedBaseline)) {
      throw new Error(`Watchlist verification failed: expected ${JSON.stringify(sortedBaseline)}, got ${JSON.stringify(sortedVerify)}`);
    }
  } finally {
    await context.dispose();
  }

  return target;
}

test.describe('Watchlist & Chart E2E', () => {
  let pageObj: WatchlistPage;
  let baselineWatchlist: string;

  test.beforeEach(async ({ page }) => {
    // Ensure known backend state before each test
    baselineWatchlist = await resetWatchlist();

    pageObj = new WatchlistPage(page);
    await pageObj.goto();
    await pageObj.waitForWatchlistLoaded();
  });

  test('heading shows the active watchlist and the menu lists all watchlists', async () => {
    await expect(pageObj.watchlistTrigger).toHaveText(baselineWatchlist);

    await pageObj.openWatchlistMenu();
    await expect(pageObj.watchlistMenu).toBeVisible();
    await expect(pageObj.watchlistOption(baselineWatchlist)).toHaveAttribute('aria-checked', 'true');
    await expect(pageObj.watchlistMenuItem('New watchlist')).toBeVisible();
    await expect(pageObj.watchlistMenuItem('Rename')).toBeVisible();
    await expect(pageObj.watchlistMenuItem('Delete')).toBeVisible();

    // Escape closes the menu and restores focus to the trigger
    await pageObj.page.keyboard.press('Escape');
    await expect(pageObj.watchlistMenu).toBeHidden();
    await expect(pageObj.watchlistTrigger).toBeFocused();
  });

  test('can switch to another watchlist and back', async () => {
    const temp = uniqueName('Switch');
    await createWatchlistApi(temp);

    try {
      await pageObj.goto();
      await pageObj.waitForWatchlistLoaded();

      await pageObj.switchWatchlist(temp);
      await expect(pageObj.watchlistTrigger).toHaveText(temp);
      await expect(pageObj.emptyState).toBeVisible();
      await expect(pageObj.emptyState).toContainText('No symbols yet.');

      await pageObj.switchWatchlist(baselineWatchlist);
      await expect(pageObj.watchlistTrigger).toHaveText(baselineWatchlist);
      await expect(pageObj.watchRows.first()).toBeVisible();
    } finally {
      await deleteWatchlistApi(temp);
    }
  });

  test('heading uses the available width for the watchlist name', async () => {
    const temp = uniqueName('Layout');
    await createWatchlistApi(temp);

    try {
      await pageObj.goto();
      await pageObj.waitForWatchlistLoaded();
      await pageObj.switchWatchlist(temp);
      await expect(pageObj.watchlistTrigger).toHaveText(temp);

      const nameBox = await pageObj.page.locator('.watchlist-trigger-name').evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      // The full name is visible (the old shrink-to-fit trigger clipped it).
      expect(nameBox.scrollWidth).toBeLessThanOrEqual(nameBox.clientWidth);
      // ...and it uses the heading space instead of collapsing to its content.
      expect(nameBox.clientWidth).toBeGreaterThan(150);

      // The trigger still stops before the symbol count.
      const triggerBox = await pageObj.watchlistTrigger.boundingBox();
      const countBox = await pageObj.page.locator('.watchlist-heading > span').boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(countBox).not.toBeNull();
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(countBox!.x + 1);
    } finally {
      await deleteWatchlistApi(temp);
    }
  });

  test('can create a watchlist and it becomes active', async () => {
    const temp = uniqueName('Create');

    try {
      await pageObj.createWatchlist(temp);
      await expect(pageObj.watchlistTrigger).toHaveText(temp);
      await expect(pageObj.emptyState).toBeVisible();

      await pageObj.openWatchlistMenu();
      await expect(pageObj.watchlistOption(temp)).toHaveAttribute('aria-checked', 'true');
      await pageObj.page.keyboard.press('Escape');
    } finally {
      await deleteWatchlistApi(temp);
    }
  });

  test('new watchlist modal rejects an empty name', async () => {
    await pageObj.openWatchlistMenu();
    await pageObj.watchlistMenuItem('New watchlist').click();
    await pageObj.nameInput.waitFor({ state: 'visible' });

    await pageObj.nameModal.locator('button[type="submit"]').click();
    await expect(pageObj.nameError).toBeVisible();
    await expect(pageObj.nameError).toHaveAttribute('role', 'alert');

    await pageObj.page.keyboard.press('Escape');
    await expect(pageObj.nameModal).toBeHidden();
  });

  test('add symbol modal closes on Escape and exposes dialog semantics', async () => {
    await pageObj.addSymbolButton.click();
    await pageObj.symbolInput.waitFor({ state: 'visible' });
    await expect(pageObj.addModal).toHaveAttribute('role', 'dialog');
    await expect(pageObj.addModal).toHaveAttribute('aria-modal', 'true');

    await pageObj.page.keyboard.press('Escape');
    await expect(pageObj.addModal).toBeHidden();
  });

  test('name validation error clears while correcting the input', async () => {
    await pageObj.openWatchlistMenu();
    await pageObj.watchlistMenuItem('New watchlist').click();
    await pageObj.nameInput.waitFor({ state: 'visible' });

    // Empty submit shows the error
    await pageObj.nameModal.locator('button[type="submit"]').click();
    await expect(pageObj.nameError).toBeVisible();
    await expect(pageObj.nameInput).toHaveAttribute('aria-invalid', 'true');

    // Typing a valid name clears the stale error and invalid state
    await pageObj.nameInput.fill('Valid name');
    await expect(pageObj.nameError).toBeHidden();
    await expect(pageObj.nameInput).toHaveAttribute('aria-invalid', 'false');

    // Close without creating anything
    await pageObj.page.keyboard.press('Escape');
    await expect(pageObj.nameModal).toBeHidden();
  });

  test('can rename the active watchlist', async () => {
    const original = uniqueName('Rename');
    const renamed = uniqueName('Renamed');
    await createWatchlistApi(original);

    try {
      await pageObj.goto();
      await pageObj.waitForWatchlistLoaded();

      await pageObj.switchWatchlist(original);
      await pageObj.renameActiveWatchlist(renamed);

      await expect(pageObj.watchlistTrigger).toHaveText(renamed);

      await pageObj.openWatchlistMenu();
      await expect(pageObj.watchlistOption(renamed)).toHaveAttribute('aria-checked', 'true');
      await expect(pageObj.watchlistOption(original)).toHaveCount(0);
      await pageObj.page.keyboard.press('Escape');
    } finally {
      await deleteWatchlistApi(original);
      await deleteWatchlistApi(renamed);
    }
  });

  test('can delete the active watchlist after confirming', async () => {
    const temp = uniqueName('Delete');
    await createWatchlistApi(temp);

    try {
      await pageObj.goto();
      await pageObj.waitForWatchlistLoaded();

      await pageObj.switchWatchlist(temp);
      await expect(pageObj.watchlistTrigger).toHaveText(temp);

      pageObj.page.once('dialog', (dialog) => dialog.accept());
      await pageObj.clickDeleteWatchlist();

      // Falls back to the first remaining watchlist
      await expect(pageObj.watchlistTrigger).toHaveText(baselineWatchlist);
      await expect(pageObj.watchRows.first()).toBeVisible();

      await pageObj.openWatchlistMenu();
      await expect(pageObj.watchlistOption(temp)).toHaveCount(0);
      await pageObj.page.keyboard.press('Escape');
    } finally {
      await deleteWatchlistApi(temp);
    }
  });

  test('loads watchlist with symbols and displays chart', async () => {
    // Watchlist should have baseline symbols
    const count = await pageObj.getRowCount();
    expect(count).toBeGreaterThan(0);

    // Should not still be loading
    await expect(pageObj.watchlist.locator('.sidebar-message')).toHaveCount(0);

    // Default symbol selected and chart visible
    await expect(pageObj.selectedSymbolHeading).toBeVisible();
    await expect(pageObj.chart).toBeVisible();
  });

  test('remove button is hidden by default and appears on hover', async () => {
    const firstRow = pageObj.watchRows.first();
    const removeBtn = firstRow.locator('.remove-symbol');

    // Hidden by default — does not cover price
    await expect(removeBtn).toBeHidden();

    // Visible on hover
    await firstRow.hover();
    await expect(removeBtn).toBeVisible();
  });

  test('remove button is reachable with the keyboard', async () => {
    const firstRow = pageObj.watchRows.first();
    const removeBtn = firstRow.locator('.remove-symbol');

    await expect(removeBtn).toBeHidden();

    // Focusing the row reveals the control...
    await firstRow.locator('.watch-row').focus();
    await expect(removeBtn).toBeVisible();

    // ...and Tab moves focus onto it.
    await pageObj.page.keyboard.press('Tab');
    await expect(removeBtn).toBeFocused();
  });

  test('can remove a stock symbol via the X button', async () => {
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

  test('can add a new symbol and switch to it', async () => {
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

  test('duplicate add shows error but closes modal', async () => {
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

  test('date range picker opens and closes', async () => {
    await pageObj.openDatePicker();
    await expect(pageObj.datePickerPopover).toBeVisible();

    await pageObj.closeDatePicker();
    await expect(pageObj.datePickerPopover).toBeHidden();
  });

  test('switching symbols updates chart', async () => {
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

    // Hover over the chart: crosshair labels appear (15% from left, 36% from top)
    await pageObj.chartHoverAt(0.15, 0.36);
    await expect(pageObj.crosshairPriceLabel).toBeVisible();

    // Debug: check if crosshair line exists
    const crosshairLine = pageObj.page.locator('.crosshair-line');
    const lineCount = await crosshairLine.count();
    console.log(`Crosshair lines found: ${lineCount}`);

    // Wait for date label to appear (crosshairLineScreenX is set asynchronously)
    await expect(pageObj.crosshairDateLabel).toBeVisible({ timeout: 10000 });

    // Move horizontally: the date label follows the candle under the pointer (45% from left)
    const firstDate = (await pageObj.crosshairDateLabel.textContent())?.trim();
    await pageObj.chartHoverAt(0.45, 0.36);
    const secondDate = (await pageObj.crosshairDateLabel.textContent())?.trim();
    expect(secondDate).toBeTruthy();
    expect(secondDate).not.toBe(firstDate);

    // Move off the chart: crosshair labels hide again
    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairPriceLabel).toBeHidden();
    await expect(pageObj.crosshairDateLabel).toBeHidden();
  });

  test('MACD and RSI panes track the pointer with a horizontal line, value label and crosshair', async ({ page }) => {
    await expect(pageObj.chart).toBeVisible();

    const globalLine = page.locator('.crosshair-line-global');
    const dateLabel = pageObj.crosshairDateLabel;
    await expect(globalLine).toHaveCount(0);
    await expect(dateLabel).toBeHidden();

    const macd = page.locator('.macd-chart .indicator-svg');
    const macdTag = page.locator('.macd-chart .axis-tag');
    const macdLine = page.locator('.macd-chart .crosshair-line');
    await expect(macdTag).toBeHidden();

    const macdBox = await macd.boundingBox();
    if (!macdBox) throw new Error('MACD pane is not visible');
    await page.mouse.move(macdBox.x + macdBox.width * 0.8, macdBox.y + macdBox.height * 0.7);
    await expect(macdTag).toBeVisible();
    await expect(macdLine).toHaveCount(1);
    const macdValue = (await macdTag.textContent())?.trim() ?? '';
    expect(macdValue).toMatch(/^-?\d+\.\d{4}$/);

    // The pane also drives the single global crosshair and its date label
    await expect(globalLine).toHaveCount(1);
    await expect(dateLabel).toBeVisible();

    // The tracked line is horizontal
    const macdY1 = await macdLine.getAttribute('y1');
    if (!macdY1) throw new Error('MACD crosshair line has no y1');
    expect(macdY1).toBe(await macdLine.getAttribute('y2'));

    // The horizontal line and the tag both move with the pointer vertically
    const macdTop = await macdTag.evaluate((el) => (el as HTMLElement).style.top);
    await page.mouse.move(macdBox.x + macdBox.width * 0.8, macdBox.y + macdBox.height * 0.3);
    await expect(macdTag).not.toHaveText(macdValue);
    await expect(macdLine).not.toHaveAttribute('y1', macdY1);
    await expect.poll(() => macdTag.evaluate((el) => (el as HTMLElement).style.top)).not.toBe(macdTop);

    // Moving horizontally snaps the crosshair to a different candle date
    const macdDate = (await dateLabel.textContent())?.trim() ?? '';
    await page.mouse.move(macdBox.x + macdBox.width * 0.3, macdBox.y + macdBox.height * 0.3);
    await expect(dateLabel).not.toHaveText(macdDate);
    await expect(globalLine).toHaveCount(1);

    // Leaving the pane clears the line, label and global crosshair
    await page.mouse.move(macdBox.x - 40, macdBox.y + macdBox.height / 2);
    await expect(macdTag).toBeHidden();
    await expect(macdLine).toHaveCount(0);
    await expect(globalLine).toHaveCount(0);
    await expect(dateLabel).toBeHidden();

    const rsi = page.locator('.rsi-chart .indicator-svg');
    const rsiTag = page.locator('.rsi-chart .axis-tag');
    const rsiLine = page.locator('.rsi-chart .crosshair-line');
    await expect(rsiTag).toBeHidden();

    const rsiBox = await rsi.boundingBox();
    if (!rsiBox) throw new Error('RSI pane is not visible');
    await page.mouse.move(rsiBox.x + rsiBox.width * 0.8, rsiBox.y + rsiBox.height * 0.7);
    await expect(rsiTag).toBeVisible();
    await expect(rsiLine).toHaveCount(1);
    const rsiText = (await rsiTag.textContent())?.trim() ?? '';
    expect(rsiText).toMatch(/^\d+\.\d{2}$/);
    expect(Number(rsiText)).toBeGreaterThan(0);
    expect(Number(rsiText)).toBeLessThan(100);

    await expect(globalLine).toHaveCount(1);
    await expect(dateLabel).toBeVisible();

    const rsiY1 = await rsiLine.getAttribute('y1');
    if (!rsiY1) throw new Error('RSI crosshair line has no y1');
    expect(rsiY1).toBe(await rsiLine.getAttribute('y2'));
    const rsiTop = await rsiTag.evaluate((el) => (el as HTMLElement).style.top);
    await page.mouse.move(rsiBox.x + rsiBox.width * 0.8, rsiBox.y + rsiBox.height * 0.3);
    await expect(rsiLine).not.toHaveAttribute('y1', rsiY1);
    await expect.poll(() => rsiTag.evaluate((el) => (el as HTMLElement).style.top)).not.toBe(rsiTop);

    const rsiDate = (await dateLabel.textContent())?.trim() ?? '';
    await page.mouse.move(rsiBox.x + rsiBox.width * 0.3, rsiBox.y + rsiBox.height * 0.3);
    await expect(dateLabel).not.toHaveText(rsiDate);

    await page.mouse.move(rsiBox.x - 40, rsiBox.y + rsiBox.height / 2);
    await expect(rsiTag).toBeHidden();
    await expect(rsiLine).toHaveCount(0);
    await expect(globalLine).toHaveCount(0);
    await expect(dateLabel).toBeHidden();
  });

  test('RSI pane plots a single RSI line', async ({ page }) => {
    await expect(pageObj.chart).toBeVisible();
    const rsiPath = page.locator('.rsi-chart .indicator-svg path');
    await expect(rsiPath).toHaveCount(1);
    await expect(rsiPath).toHaveAttribute('stroke', '#6d28d9');
    await expect(rsiPath).toHaveAttribute('d', /^M-?[\d.]/);
  });

  test('selecting another symbol clears the MACD hover tag, global crosshair and date label', async ({ page }) => {
    const symbols = (
      await pageObj.watchRows.locator('.watch-row-identity b').allTextContents()
    ).map((symbol) => symbol.trim());
    const current = (await pageObj.selectedSymbolHeading.textContent())?.trim() ?? '';
    const nextSymbol = symbols.find((symbol) => symbol !== current);
    if (!nextSymbol) {
      test.skip(true, 'needs a second symbol in the baseline watchlist');
      return;
    }

    const macd = page.locator('.macd-chart .indicator-svg');
    const macdTag = page.locator('.macd-chart .axis-tag');
    const globalLine = page.locator('.crosshair-line-global');
    const dateLabel = pageObj.crosshairDateLabel;

    const box = await macd.boundingBox();
    if (!box) throw new Error('MACD pane is not visible');
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
    await expect(macdTag).toBeVisible();
    await expect(globalLine).toHaveCount(1);
    await expect(dateLabel).toBeVisible();

    await pageObj.clickRow(nextSymbol);
    await expect(pageObj.selectedSymbolHeading).toHaveText(nextSymbol);
    await expect(pageObj.chart).toBeVisible();

    await expect(macdTag).toBeHidden();
    await expect(globalLine).toHaveCount(0);
    await expect(dateLabel).toBeHidden();
  });

  test('a settled history fetch clears hover state from the previous series', async ({ page }) => {
    await expect(pageObj.chart).toBeVisible();

    const macd = page.locator('.macd-chart .indicator-svg');
    const macdTag = page.locator('.macd-chart .axis-tag');
    const globalLine = page.locator('.crosshair-line-global');
    const dateLabel = pageObj.crosshairDateLabel;

    let releaseHold = () => {};
    const held = new Promise<void>((resolve) => { releaseHold = resolve; });
    let markSeen = () => {};
    const seen = new Promise<void>((resolve) => { markSeen = resolve; });
    let holdNextHistory = false;

    await page.route('**/api/stocks/history*', async (route) => {
      if (!holdNextHistory) {
        await route.continue();
        return;
      }
      holdNextHistory = false;
      markSeen();
      await held;
      await route.continue();
    });

    try {
      // Change the date range so a history fetch starts while the old series is still plotted.
      await pageObj.openDatePicker();
      await page.locator('.date-picker-presets button').filter({ hasText: 'Past month' }).click();
      const responseReceived = page.waitForResponse(
        (response) => response.url().includes('/api/stocks/history') && response.url().includes('start='),
      );
      holdNextHistory = true;
      await page.locator('.date-picker-apply').click();
      await seen;

      // Hover the MACD pane while the request is held: the old series is still rendered.
      const box = await macd.boundingBox();
      if (!box) throw new Error('MACD pane is not visible');
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
      await expect(macdTag).toBeVisible();
      await expect(globalLine).toHaveCount(1);
      await expect(dateLabel).toBeVisible();

      releaseHold();
      await responseReceived;
      await expect(pageObj.chart).toBeVisible();

      // No pointer moved onto the pane after the new series landed.
      await expect(macdTag).toBeHidden();
      await expect(globalLine).toHaveCount(0);
      await expect(dateLabel).toBeHidden();
    } finally {
      releaseHold();
      await page.unroute('**/api/stocks/history*');
    }
  });
});

test.describe('Watchlist mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('a long active watchlist name does not overflow the viewport', async ({ page }) => {
    const name = `Long ${'x'.repeat(20)}${Date.now()}`; // 38 characters, unique
    await createWatchlistApi(name);
    const pageObj = new WatchlistPage(page);
    const viewportWidth = page.viewportSize()!.width;

    try {
      await pageObj.goto();
      await pageObj.switchWatchlist(name);
      await expect(pageObj.watchlistTrigger).toHaveText(name);
      await pageObj.openWatchlistMenu();

      const hasNoHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(hasNoHorizontalScroll).toBe(true);

      const menuBox = await pageObj.watchlistMenu.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewportWidth);
    } finally {
      await deleteWatchlistApi(name);
    }
  });

  test('indicator panes track the pointer without overflowing the viewport', async ({ page }) => {
    const name = uniqueName('MobileHover');
    const pageObj = new WatchlistPage(page);

    try {
      await createWatchlistApi(name);
      await addSymbolToWatchlistApi(name, 'TSM');
      await pageObj.goto();
      await pageObj.switchWatchlist(name);
      await expect(pageObj.chart).toBeVisible();

      for (const [svgClass, axisClass] of [
        ['.macd-chart .indicator-svg', '.macd-chart .empty-axis'],
        ['.rsi-chart .indicator-svg', '.rsi-chart .rsi-axis'],
      ]) {
        const svg = page.locator(svgClass);
        const axis = page.locator(axisClass);
        const tag = axis.locator('.axis-tag');
        const line = page.locator(svgClass.replace(' .indicator-svg', ' .crosshair-line'));
        const globalLine = page.locator('.crosshair-line-global');

        // 60-70% height keeps the pointer clear of the top-left pane heading
        const box = await svg.boundingBox();
        if (!box) throw new Error('indicator pane is not visible');
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.65);

        await expect(tag).toBeVisible();
        await expect(line).toHaveCount(1);
        await expect(globalLine).toHaveCount(1);

        // The tag sits inside its own axis column and does not widen the page
        const tagBox = await tag.boundingBox();
        if (!tagBox) throw new Error('axis tag is not visible');
        const axisBox = await axis.boundingBox();
        if (!axisBox) throw new Error('axis column is not visible');
        expect(tagBox.x).toBeGreaterThanOrEqual(axisBox.x - 1);
        expect(tagBox.x + tagBox.width).toBeLessThanOrEqual(axisBox.x + axisBox.width + 1);
        const hasNoHorizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(hasNoHorizontalScroll).toBe(true);

        // (1, 1) is a fixed in-viewport point outside every pane at 375px.
        await page.mouse.move(1, 1);
        await expect(tag).toBeHidden();
        await expect(line).toHaveCount(0);
        await expect(globalLine).toHaveCount(0);
      }
    } finally {
      await deleteWatchlistApi(name);
    }
  });
});
