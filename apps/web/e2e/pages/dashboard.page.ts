import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly navigationBar: Locator;
  readonly uploadButton: Locator;
  readonly earningsCard: Locator;
  readonly subscribersCard: Locator;
  readonly contentCard: Locator;

  constructor(page: Page) {
    this.page = page;
    this.navigationBar = page.locator('nav');
    this.uploadButton = page.locator('a:has-text("Upload")');
    this.earningsCard = page.locator('text=Revenus Totaux').locator('..');
    this.subscribersCard = page.locator('text=Abonnés').locator('..');
    this.contentCard = page.locator('text=Contenus').locator('..');
  }

  async goto() {
    await this.page.goto('/creator/dashboard');
  }

  async expectToBeOnDashboard() {
    await expect(this.page).toHaveURL(/\/creator\/dashboard/);
    await expect(this.page.locator('h1:has-text("Dashboard Créateur")')).toBeVisible();
  }

  async navigateToUpload() {
    await this.uploadButton.click();
    await this.page.waitForURL(/\/creator\/upload/);
  }

  async navigateToAnalytics() {
    await this.page.click('a:has-text("Analytics")');
    await this.page.waitForURL(/\/creator\/analytics/);
  }

  async navigateToSubscriptions() {
    await this.page.click('a:has-text("Abonnements")');
    await this.page.waitForURL(/\/creator\/subscriptions/);
  }

  async navigateToMessages() {
    await this.page.click('a:has-text("Messages")');
    await this.page.waitForURL(/\/messages/);
  }

  async expectEarningsVisible() {
    await expect(this.earningsCard).toBeVisible();
  }

  async expectSubscribersVisible() {
    await expect(this.subscribersCard).toBeVisible();
  }

  async expectContentVisible() {
    await expect(this.contentCard).toBeVisible();
  }

  async getEarningsValue(): Promise<string> {
    const earnings = await this.earningsCard.locator('.text-2xl').textContent();
    return earnings || '0';
  }

  async getSubscribersCount(): Promise<number> {
    const count = await this.subscribersCard.locator('.text-2xl').textContent();
    return parseInt(count || '0');
  }
}
