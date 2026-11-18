import { test, expect, request } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';
import { dateLabel, priceLabel } from '../../lib/format';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';
const XHR_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
const SYMBOL = 'TSM';
const EMA_KEYS = ['ema_9', 'ema_21', 'ema_50', 'ema_200'] as const;

type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ema_9: number;
  ema_21: number;
  ema_50: number;
  ema_200: number;
};

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}`;
}

const watchlistName = uniqueName('Legend');

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

async function fetchCandles(symbol: string) {
  const context = await request.newContext({ extraHTTPHeaders: XHR_HEADERS });
  try {
    const response = await context.get(`${API_URL}/api/stocks/history`, {
      params: { symbol, range: '1W' },
    });
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as { candles?: Candle[] };
    return data.candles ?? [];
  } finally {
    await context.dispose();
  }
}

// Values are concatenated in textContent (no separators between the value spans),
// so match them against the rendered innerText instead.
async function readEmaText(ema: Locator) {
  return (await ema.innerText()).replace(/\s+/g, ' ').trim();
}

function valueIndex(text: string, value: string) {
  const match = new RegExp(`(^|\\s)${value.replace('.', '\\.')}($|\\s)`).exec(text);
  return match ? match.index + match[1].length : -1;
}

function hasValue(text: string, value: string) {
  return valueIndex(text, value) >= 0;
}

function emaValuesInOrder(text: string, candle: Candle) {
  const positions = EMA_KEYS.map((key) => valueIndex(text, priceLabel(candle[key], SYMBOL)));
  return positions.every((index) => index >= 0) &&
    positions.join() === [...positions].sort((a, b) => a - b).join();
}

async function openOwnWatchlist(page: Page) {
  const pageObj = new WatchlistPage(page);
  await pageObj.goto();
  // Switch before waiting for rows: the default watchlist may be transiently
  // empty while watchlist.spec.ts resets it on a parallel worker.
  await expect(pageObj.watchlistTrigger).toBeEnabled();
  await pageObj.switchWatchlist(watchlistName);
  await pageObj.waitForWatchlistLoaded();
  await expect(pageObj.chart).toBeVisible();
  return pageObj;
}

test.beforeAll(async () => {
  await createWatchlistApi(watchlistName);
  await addSymbolToWatchlistApi(watchlistName, SYMBOL);
});

test.afterAll(async () => {
  await deleteWatchlistApi(watchlistName);
});

test.describe('Chart legend tiles', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let pageObj: WatchlistPage;

  test.beforeEach(async ({ page }) => {
    pageObj = await openOwnWatchlist(page);
  });

  test('both tiles render in a stack without overlap', async ({ page }) => {
    const ohlc = page.locator('.ohlc-legend');
    const ema = page.locator('.main-indicator-legend');

    await expect(ohlc).toBeVisible();
    await expect(ema).toBeVisible();

    const ohlcBox = await ohlc.boundingBox();
    const emaBox = await ema.boundingBox();
    expect(ohlcBox).not.toBeNull();
    expect(emaBox).not.toBeNull();
    expect(ohlcBox!.width).toBeGreaterThan(0);
    expect(ohlcBox!.height).toBeGreaterThan(0);
    expect(emaBox!.width).toBeGreaterThan(0);
    expect(emaBox!.height).toBeGreaterThan(0);
    expect(ohlcBox!.y + ohlcBox!.height).toBeLessThanOrEqual(emaBox!.y);
  });

  test('tiles share surface styling and the EMA tile keeps its anchor', async ({ page }) => {
    const styles = await page.evaluate(() => {
      const read = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        const cs = getComputedStyle(el);
        return {
          background: cs.backgroundColor,
          radius: cs.borderRadius,
          fontSize: cs.fontSize,
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          borderTopColor: cs.borderTopColor,
          fontFamily: cs.fontFamily,
          boxShadow: cs.boxShadow,
        };
      };
      return {
        ohlc: read('.ohlc-legend'),
        ema: read('.main-indicator-legend'),
      };
    });

    expect(styles.ohlc.background).toBe('rgb(255, 255, 255)');
    expect(styles.ohlc).toEqual(styles.ema);
    expect(styles.ema.fontSize).toBe('12px');

    expect(styles.ohlc.radius).toBe('6px');
    expect(styles.ohlc.paddingTop).toBe('4px');
    expect(styles.ohlc.paddingRight).toBe('8px');
    expect(styles.ohlc.paddingBottom).toBe('4px');
    expect(styles.ohlc.paddingLeft).toBe('8px');
    expect(styles.ohlc.borderTopColor).toBe('rgb(201, 194, 178)');
    expect(styles.ohlc.fontFamily).toContain('JetBrains Mono');
    expect(styles.ohlc.boxShadow).not.toBe('none');

    const emaBox = await page.locator('.main-indicator-legend').boundingBox();
    const paneBox = await page.locator('.price-chart').boundingBox();
    expect(emaBox).not.toBeNull();
    expect(paneBox).not.toBeNull();
    expect(emaBox!.x - paneBox!.x).toBeCloseTo(12, 0);
  });

  test('tiles show the hovered candle and change between hover positions', async ({ page }) => {
    const ohlc = page.locator('.ohlc-legend');
    const ema = page.locator('.main-indicator-legend');
    const candles = await fetchCandles(SYMBOL);
    expect(candles.length).toBeGreaterThan(1);

    const readAt = async (xRatio: number) => {
      await pageObj.chartHoverAt(xRatio, 0.36);
      await expect(pageObj.crosshairDateLabel).toBeVisible();

      // The 1W series has several intraday candles per day, so the date label
      // alone is ambiguous; the four EMA values pin the exact candle.
      let matched: Candle | undefined;
      await expect
        .poll(async () => {
          const label = ((await pageObj.crosshairDateLabel.textContent()) ?? '').trim();
          const emaText = await readEmaText(ema);
          matched = candles.find(
            (candidate) => dateLabel(candidate.date) === label && emaValuesInOrder(emaText, candidate),
          );
          return Boolean(matched);
        })
        .toBe(true);

      const candle = matched!;
      await expect(ohlc).toContainText(`O ${priceLabel(candle.open, SYMBOL)}`);
      await expect(ohlc).toContainText(`H ${priceLabel(candle.high, SYMBOL)}`);
      await expect(ohlc).toContainText(`L ${priceLabel(candle.low, SYMBOL)}`);
      await expect(ohlc).toContainText(`C ${priceLabel(candle.close, SYMBOL)}`);

      const emaText = await readEmaText(ema);
      const values = EMA_KEYS.map((key) => priceLabel(candle[key], SYMBOL));
      expect(values.every((value) => hasValue(emaText, value))).toBe(true);
      const positions = values.map((value) => valueIndex(emaText, value));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));

      return { ohlc: ((await ohlc.textContent()) ?? '').trim(), ema: emaText };
    };

    const first = await readAt(0.3);
    const second = await readAt(0.7);

    expect(first.ohlc).not.toBe('');
    expect(second.ohlc).not.toBe('');
    expect(second.ohlc).not.toBe(first.ohlc);
    expect(second.ema).not.toBe(first.ema);
  });

  test('tiles fall back to the last candle after the pointer leaves', async ({ page }) => {
    const ohlc = page.locator('.ohlc-legend');
    const ema = page.locator('.main-indicator-legend');

    await pageObj.chartHoverAt(0.4, 0.36);
    await expect(pageObj.crosshairDateLabel).toBeVisible();
    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairDateLabel).toBeHidden();

    // Fetch after the chart is rendered so the comparison uses the newest bar.
    const candles = await fetchCandles(SYMBOL);
    const last = candles[candles.length - 1];
    expect(last).toBeTruthy();

    await expect(ohlc).toContainText(`O ${priceLabel(last.open, SYMBOL)}`);
    await expect(ohlc).toContainText(`H ${priceLabel(last.high, SYMBOL)}`);
    await expect(ohlc).toContainText(`L ${priceLabel(last.low, SYMBOL)}`);
    await expect(ohlc).toContainText(`C ${priceLabel(last.close, SYMBOL)}`);

    const emaText = await readEmaText(ema);
    const values = EMA_KEYS.map((key) => priceLabel(last[key], SYMBOL));
    expect(values.every((value) => hasValue(emaText, value))).toBe(true);
    const positions = values.map((value) => valueIndex(emaText, value));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('pointer events pass through the tiles to the chart', async ({ page }) => {
    const ohlc = page.locator('.ohlc-legend');
    const box = await ohlc.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    expect(x).toBeGreaterThanOrEqual(box!.x);
    expect(x).toBeLessThanOrEqual(box!.x + box!.width);
    expect(y).toBeGreaterThanOrEqual(box!.y);
    expect(y).toBeLessThanOrEqual(box!.y + box!.height);

    await page.mouse.move(x, y);

    await expect(page.locator('.crosshair-line-global')).toBeVisible();
    await expect(pageObj.crosshairDateLabel).toBeVisible();
    expect(((await pageObj.crosshairDateLabel.textContent()) ?? '').trim()).not.toBe('');
  });
});

test.describe('Chart legend tiles — mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('tiles stack without overlap or horizontal overflow', async ({ page }) => {
    await openOwnWatchlist(page);

    const ohlc = page.locator('.ohlc-legend');
    const ema = page.locator('.main-indicator-legend');
    await expect(ohlc).toBeVisible();
    await expect(ema).toBeVisible();

    const ohlcBox = await ohlc.boundingBox();
    const emaBox = await ema.boundingBox();
    expect(ohlcBox).not.toBeNull();
    expect(emaBox).not.toBeNull();
    expect(ohlcBox!.height).toBeGreaterThan(0);
    expect(emaBox!.height).toBeGreaterThan(0);
    expect(ohlcBox!.y + ohlcBox!.height).toBeLessThanOrEqual(emaBox!.y);

    const fontSizes = await page.evaluate(() => ({
      ohlc: getComputedStyle(document.querySelector('.ohlc-legend') as HTMLElement).fontSize,
      ema: getComputedStyle(document.querySelector('.main-indicator-legend') as HTMLElement).fontSize,
    }));
    expect(fontSizes.ohlc).toBe('9px');
    expect(fontSizes.ema).toBe('9px');

    const paneBox = await page.locator('.price-chart').boundingBox();
    expect(paneBox).not.toBeNull();
    expect(emaBox!.x - paneBox!.x).toBeCloseTo(5, 0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
