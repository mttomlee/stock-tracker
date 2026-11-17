import { test, expect, request } from '@playwright/test';
import { WatchlistPage } from './pages/WatchlistPage';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';

test.describe('Chart pane alignment', () => {
  // Wide viewport: the candle pane's scale used to cap at 1 here while the
  // indicator panes scaled up, breaking vertical alignment.
  test.use({ viewport: { width: 1920, height: 1080 } });

  let pageObj: WatchlistPage;

  test.beforeEach(async ({ page }) => {
    // Ensure at least one symbol exists so a chart renders.
    const context = await request.newContext({
      extraHTTPHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    await context.post(`${API_URL}/api/watchlist/add_symbol`, { data: { symbol: 'TSM' } });
    await context.dispose();

    pageObj = new WatchlistPage(page);
    await pageObj.goto();
    await pageObj.waitForWatchlistLoaded();
    await expect(pageObj.chart).toBeVisible();
  });

  test('all three chart panes share the same horizontal scale', async ({ page }) => {
    const scales = await page.evaluate(() => {
      const svgs = Array.from(
        document.querySelectorAll('svg.candle-svg, svg.indicator-svg'),
      ) as SVGSVGElement[];
      return svgs.map((svg) => svg.getScreenCTM()?.a ?? null);
    });

    expect(scales).toHaveLength(3);
    expect(scales[0]).not.toBeNull();
    // Same viewBox width (1000) and same container width must yield the same
    // horizontal scale in every pane.
    expect(scales[1]).toBeCloseTo(scales[0]!, 1);
    expect(scales[2]).toBeCloseTo(scales[0]!, 1);
  });

  test('crosshair is one continuous line aligned across all panes', async ({ page }) => {
    // Off-center: a centered hover masks the scale mismatch because the
    // letterboxed candle pane and the full-width indicator panes agree there.
    await pageObj.chartHoverAt(0.2, 0.36);
    const line = page.locator('.crosshair-line-global');
    await expect(line).toHaveCount(1);
    await expect(line).toBeVisible();

    // The line must span the full height of the charts wrapper (no segments).
    const wrapperBox = await page.locator('.charts-wrapper').boundingBox();
    const lineBox = await line.boundingBox();
    expect(wrapperBox).not.toBeNull();
    expect(lineBox).not.toBeNull();
    expect(lineBox!.height).toBeCloseTo(wrapperBox!.height, 0);

    // The same screen X must map to the same viewBox X in every pane, which is
    // what makes the data points line up vertically.
    const viewBoxXs = await page.evaluate(() => {
      const el = document.querySelector('.crosshair-line-global') as HTMLElement;
      const rect = el.getBoundingClientRect();
      const screenX = rect.left + rect.width / 2;
      const svgs = Array.from(
        document.querySelectorAll('svg.candle-svg, svg.indicator-svg'),
      ) as SVGSVGElement[];
      return svgs.map((svg) => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = screenX;
        pt.y = 0;
        return pt.matrixTransform(ctm.inverse()).x;
      });
    });

    expect(viewBoxXs).toHaveLength(3);
    expect(viewBoxXs[0]).not.toBeNull();
    expect(viewBoxXs[1]).toBeCloseTo(viewBoxXs[0]!, 0);
    expect(viewBoxXs[2]).toBeCloseTo(viewBoxXs[0]!, 0);
  });
});
