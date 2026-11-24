import { test, expect, request } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';
import { dateLabel, priceLabel, signed, signedPrice } from '../../lib/format';

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
  rsi_14: number | null;
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

    const ohlcBefore = ((await ohlc.textContent()) ?? '').trim();
    const emaBefore = await readEmaText(ema);

    await pageObj.chartHoverAt(0.4, 0.36);
    await expect(pageObj.crosshairDateLabel).toBeVisible();
    await expect(ohlc).not.toHaveText(ohlcBefore);
    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairDateLabel).toBeHidden();

    await expect(ohlc).toHaveText(ohlcBefore);
    expect(await readEmaText(ema)).toBe(emaBefore);

    // Compare against the series the chart plotted, not a refetch: during market
    // hours a refetch can return a newer, still-ticking in-progress bar.
    const lastTitle = ((await page.locator('.candle-svg g > title').last().textContent()) ?? '').trim();
    const match = /O ([\d.]+) · H ([\d.]+) · L ([\d.]+) · C ([\d.]+)/.exec(lastTitle);
    expect(match).not.toBeNull();
    const [open, high, low, close] = match!.slice(1).map(Number);
    await expect(ohlc).toContainText(`O ${priceLabel(open, SYMBOL)}`);
    await expect(ohlc).toContainText(`H ${priceLabel(high, SYMBOL)}`);
    await expect(ohlc).toContainText(`L ${priceLabel(low, SYMBOL)}`);
    await expect(ohlc).toContainText(`C ${priceLabel(close, SYMBOL)}`);
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

  test('RSI tile shares the tile surface', async ({ page }) => {
    const rsi = page.locator('.rsi-legend');
    await expect(rsi).toBeVisible();

    const styles = await page.evaluate(() => {
      const read = (selector: string) => {
        const cs = getComputedStyle(document.querySelector(selector) as HTMLElement);
        return {
          background: cs.backgroundColor,
          radius: cs.borderRadius,
          fontSize: cs.fontSize,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          borderTopColor: cs.borderTopColor,
          fontFamily: cs.fontFamily,
          boxShadow: cs.boxShadow,
          pointerEvents: cs.pointerEvents,
        };
      };
      return { ohlc: read('.ohlc-legend'), rsi: read('.rsi-legend') };
    });

    expect(styles.rsi.background).toBe('rgb(255, 255, 255)');
    expect(styles.rsi).toEqual(styles.ohlc);
  });

  test('RSI tile follows the hovered candle and falls back to the last', async ({ page }) => {
    const rsiValue = page.locator('.rsi-legend .rsi-line-color');
    const candles = await fetchCandles(SYMBOL);
    expect(candles.length).toBeGreaterThan(1);
    const initial = ((await rsiValue.textContent()) ?? '').trim();

    const readAt = async (xRatio: number) => {
      await pageObj.chartHoverAt(xRatio, 0.36);
      await expect(pageObj.crosshairDateLabel).toBeVisible();

      let matched: Candle | undefined;
      await expect
        .poll(async () => {
          const label = ((await pageObj.crosshairDateLabel.textContent()) ?? '').trim();
          const emaText = await readEmaText(page.locator('.main-indicator-legend'));
          matched = candles.find(
            (candidate) => dateLabel(candidate.date) === label && emaValuesInOrder(emaText, candidate),
          );
          return Boolean(matched);
        })
        .toBe(true);

      const expected = matched!.rsi_14 === null ? '—' : matched!.rsi_14.toFixed(2);
      await expect(rsiValue).toHaveText(expected);
    };

    await readAt(0.3);
    await readAt(0.7);

    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairDateLabel).toBeHidden();
    await expect(rsiValue).toHaveText(initial);
  });

  test('change tile sits left of OHLC and follows the hovered candle', async ({ page }) => {
    const tile = page.locator('.change-legend');
    const ohlc = page.locator('.ohlc-legend');
    await expect(tile).toBeVisible();

    const tileBox = await tile.boundingBox();
    const ohlcBox = await ohlc.boundingBox();
    expect(tileBox).not.toBeNull();
    expect(ohlcBox).not.toBeNull();
    expect(tileBox!.x + tileBox!.width).toBeLessThanOrEqual(ohlcBox!.x);
    expect(await tile.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

    // Values sit flush against the tile padding, not in a reserved value slot.
    const firstValueBox = await tile.locator('span').first().boundingBox();
    expect(firstValueBox!.x - tileBox!.x).toBeLessThan(12);

    const candles = await fetchCandles(SYMBOL);
    expect(candles.length).toBeGreaterThan(1);

    const readTile = async () => [
      ((await tile.locator('span').nth(0).textContent()) ?? '').trim(),
      ((await tile.locator('span').nth(1).textContent()) ?? '').trim(),
    ];
    const expectedAt = (index: number) => {
      const change = candles[index].close - candles[index - 1].close;
      return [signedPrice(change, SYMBOL), signed((change / candles[index - 1].close) * 100, '%')];
    };

    const readAt = async (xRatio: number) => {
      const before = (await ohlc.innerText()).replace(/\s+/g, ' ');
      await pageObj.chartHoverAt(xRatio, 0.36);
      await expect(pageObj.crosshairDateLabel).toBeVisible();

      // Pin the candle with the date label plus all four EMA values; the date
      // alone is ambiguous with several intraday candles per day. The render must
      // also differ from the pre-hover legend, or the poll resolves the old candle.
      let index = -1;
      await expect
        .poll(async () => {
          const ohlcText = (await ohlc.innerText()).replace(/\s+/g, ' ');
          if (ohlcText === before) return -1;
          const label = ((await pageObj.crosshairDateLabel.textContent()) ?? '').trim();
          const emaText = await readEmaText(page.locator('.main-indicator-legend'));
          index = candles.findIndex(
            (candidate) =>
              dateLabel(candidate.date) === label &&
              emaValuesInOrder(emaText, candidate) &&
              [candidate.open, candidate.high, candidate.low, candidate.close].every((value) =>
                ohlcText.includes(priceLabel(value, SYMBOL)),
              ),
          );
          return index;
        })
        .toBeGreaterThan(0);

      await expect.poll(readTile).toEqual(expectedAt(index));
    };

    await readAt(0.3);
    await readAt(0.7);

    // First plotted candle has no predecessor: the tile falls back to a dash.
    await pageObj.chartHoverAt(0.005, 0.36);
    await expect.poll(async () => ((await tile.locator('span').nth(0).textContent()) ?? '').trim()).toBe('—');

    // Falls back to the last plotted candle: compare against the plotted series,
    // not a refetch, because the newest bar can still be ticking.
    await pageObj.chartHoverLeave();
    await expect(pageObj.crosshairDateLabel).toBeHidden();
    const titles = await page.locator('.candle-svg g > title').allTextContents();
    const closes = titles.map((title) => Number(/C ([\d.]+)/.exec(title)![1]));
    const last = closes.length - 1;
    const change = closes[last] - closes[last - 1];
    await expect.poll(readTile).toEqual([
      signedPrice(change, SYMBOL),
      signed((change / closes[last - 1]) * 100, '%'),
    ]);
  });

  test('pointer events pass through the RSI tile to the chart', async ({ page }) => {
    const box = await page.locator('.rsi-legend').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(page.locator('.crosshair-line-global')).toBeVisible();
    await expect(pageObj.crosshairDateLabel).toBeVisible();
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
      change: getComputedStyle(document.querySelector('.change-legend') as HTMLElement).fontSize,
    }));
    expect(fontSizes.ohlc).toBe('9px');
    expect(fontSizes.ema).toBe('9px');
    expect(fontSizes.change).toBe('9px');
    await expect(page.locator('.change-legend')).toBeVisible();

    const paneBox = await page.locator('.price-chart').boundingBox();
    expect(paneBox).not.toBeNull();
    expect(emaBox!.x - paneBox!.x).toBeCloseTo(5, 0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('RSI tile fits at 375px without overflow', async ({ page }) => {
    await openOwnWatchlist(page);

    const rsi = page.locator('.rsi-legend');
    await expect(rsi).toBeVisible();

    const fontSize = await page.evaluate(
      () => getComputedStyle(document.querySelector('.rsi-legend') as HTMLElement).fontSize,
    );
    expect(fontSize).toBe('9px');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
