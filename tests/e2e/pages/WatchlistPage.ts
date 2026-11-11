import { Page, Locator } from '@playwright/test';

export class WatchlistPage {
  readonly page: Page;

  // Selectors
  readonly heading: Locator;
  readonly addSymbolButton: Locator;
  readonly watchlist: Locator;
  readonly watchRows: Locator;
  readonly symbolInput: Locator;
  readonly addModal: Locator;
  readonly addModalSubmit: Locator;
  readonly modalClose: Locator;
  readonly dateRangeTrigger: Locator;
  readonly datePickerPopover: Locator;
  readonly chart: Locator;
  readonly selectedSymbolHeading: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.addSymbolButton = page.locator('.add-symbol');
    this.watchlist = page.locator('[aria-label="Watchlist"]');
    this.watchRows = page.locator('.watch-row-wrap');
    this.symbolInput = page.locator('#symbol-input');
    this.addModal = page.locator('.add-modal');
    this.addModalSubmit = page.locator('form.add-modal button[type="submit"]');
    this.modalClose = page.locator('.modal-close');
    this.dateRangeTrigger = page.locator('.date-range-trigger');
    this.datePickerPopover = page.locator('.date-picker-popover');
    this.chart = page.locator('svg.candle-svg');
    this.selectedSymbolHeading = page.locator('h2');
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
}
