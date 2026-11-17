import { Page, Locator } from '@playwright/test';

export class WatchlistPage {
  readonly page: Page;

  // Selectors
  readonly heading: Locator;
  readonly watchlistTrigger: Locator;
  readonly watchlistMenu: Locator;
  readonly addSymbolButton: Locator;
  readonly watchlist: Locator;
  readonly watchRows: Locator;
  readonly emptyState: Locator;
  readonly nameModal: Locator;
  readonly nameInput: Locator;
  readonly nameError: Locator;
  readonly symbolInput: Locator;
  readonly addModal: Locator;
  readonly addModalSubmit: Locator;
  readonly modalClose: Locator;
  readonly dateRangeTrigger: Locator;
  readonly datePickerPopover: Locator;
  readonly chart: Locator;
  readonly crosshairPriceLabel: Locator;
  readonly crosshairDateLabel: Locator;
  readonly selectedSymbolHeading: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.watchlistTrigger = page.locator('.watchlist-trigger');
    this.watchlistMenu = page.locator('#watchlist-menu');
    this.addSymbolButton = page.locator('.add-symbol');
    this.watchlist = page.locator('[aria-label="Watchlist"]');
    this.watchRows = page.locator('.watch-row-wrap');
    this.emptyState = page.locator('.watchlist-empty');
    this.nameModal = page.locator('.watchlist-name-modal');
    this.nameInput = page.locator('#watchlist-name-input');
    this.nameError = page.locator('.watchlist-name-error');
    this.symbolInput = page.locator('#symbol-input');
    this.addModal = page.locator('.add-modal:not(.watchlist-name-modal)');
    this.addModalSubmit = page.locator('form.add-modal button[type="submit"]');
    this.modalClose = page.locator('.modal-close');
    this.dateRangeTrigger = page.locator('.date-range-trigger');
    this.datePickerPopover = page.locator('.date-picker-popover');
    this.chart = page.locator('svg.candle-svg');
    this.crosshairPriceLabel = page.locator('.crosshair-tracking-price');
    this.crosshairDateLabel = page.locator('.crosshair-tracking-date');
    this.selectedSymbolHeading = page.locator('.quote-heading h2');
    this.errorBanner = page.locator('.error-banner');
  }

  async goto() {
    await this.page.goto('/', { waitUntil: 'networkidle' });
    await this.page.waitForLoadState('networkidle');
  }

  async waitForWatchlistLoaded() {
    await this.watchRows.first().waitFor({ state: 'visible', timeout: 15000 });
  }

  async getRowCount() {
    return await this.watchRows.count();
  }

  async openWatchlistMenu() {
    if (!(await this.watchlistMenu.isVisible())) {
      await this.watchlistTrigger.click();
    }
    await this.watchlistMenu.waitFor({ state: 'visible' });
  }

  watchlistMenuItem(name: string) {
    return this.watchlistMenu.getByRole('menuitem', { name, exact: true });
  }

  watchlistOption(name: string) {
    return this.watchlistMenu.getByRole('menuitemradio', { name, exact: true });
  }

  async switchWatchlist(name: string) {
    await this.openWatchlistMenu();
    await this.watchlistOption(name).click();
    await this.watchlistMenu.waitFor({ state: 'hidden' });
  }

  async createWatchlist(name: string) {
    await this.openWatchlistMenu();
    await this.watchlistMenuItem('New watchlist').click();
    await this.nameInput.waitFor({ state: 'visible' });
    await this.nameInput.fill(name);
    await this.nameModal.locator('button[type="submit"]').click();
    await this.nameModal.waitFor({ state: 'hidden' });
  }

  async renameActiveWatchlist(name: string) {
    await this.openWatchlistMenu();
    await this.watchlistMenuItem('Rename').click();
    await this.nameInput.waitFor({ state: 'visible' });
    await this.nameInput.fill(name);
    await this.nameModal.locator('button[type="submit"]').click();
    await this.nameModal.waitFor({ state: 'hidden' });
  }

  async clickDeleteWatchlist() {
    await this.openWatchlistMenu();
    await this.watchlistMenuItem('Delete').click();
  }

  getRowBySymbol(symbol: string) {
    return this.watchRows.filter({ hasText: symbol });
  }

  getRowPrice(symbol: string) {
    return this.getRowBySymbol(symbol).locator('.watch-row-price b');
  }

  async clickRow(symbol: string) {
    await this.getRowBySymbol(symbol).locator('.watch-row').first().click();
  }

  async addSymbol(symbol: string) {
    await this.addSymbolButton.click();
    await this.symbolInput.waitFor({ state: 'visible' });
    await this.symbolInput.fill(symbol);
    await this.addModalSubmit.click();
  }

  async removeSymbol(symbol: string) {
    const removeBtn = this.getRowBySymbol(symbol).locator('.remove-symbol').first();
    await removeBtn.waitFor({ state: 'visible' });
    await removeBtn.click();
  }

  async getSelectedSymbol() {
    return (await this.selectedSymbolHeading.textContent())?.trim();
  }

  async openDatePicker() {
    await this.dateRangeTrigger.click();
    await this.datePickerPopover.waitFor({ state: 'visible' });
  }

  async closeDatePicker() {
    await this.page.click('body', { position: { x: 10, y: 10 } });
  }

  async chartHoverAt(xRatio: number, yRatio: number) {
    const box = await this.chart.boundingBox();
    if (!box) throw new Error('chart is not visible');
    const x = box.x + box.width * xRatio;
    const y = box.y + box.height * yRatio;
    await this.page.mouse.move(x, y);
  }

  async chartHoverLeave() {
    const box = await this.chart.boundingBox();
    if (!box) throw new Error('chart is not visible');
    await this.page.mouse.move(box.x - 50, box.y + box.height / 2);
  }
}
