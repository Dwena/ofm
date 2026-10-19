import { Page, Locator, expect } from '@playwright/test';

/**
 * Creator dashboard (/creator/dashboard). Stat card titles are <h3> headings.
 */
export class DashboardPage {
  readonly page: Page;
  readonly navigationBar: Locator;
  readonly earningsCard: Locator;
  readonly subscribersCard: Locator;
  readonly contentCard: Locator;

  constructor(page: Page) {
    this.page = page;
    this.navigationBar = page.getByTestId('main-nav');
    this.earningsCard = page.getByRole('heading', { name: 'Revenus Totaux', exact: true });
    this.subscribersCard = page.getByRole('heading', { name: 'Abonnés', exact: true });
    this.contentCard = page.getByRole('heading', { name: 'Contenus', exact: true });
  }

  navLink(href: string): Locator {
    return this.page.getByTestId(`nav-link-${href.replace(/^\//, '').replace(/\//g, '-')}`);
  }

  async goto() {
    await this.page.goto('/creator/dashboard');
  }

  async expectToBeOnDashboard() {
    await expect(this.page).toHaveURL(/\/creator\/dashboard/);
    await expect(this.page.getByRole('heading', { level: 1, name: 'Dashboard Créateur' })).toBeVisible();
  }

  async navigateToUpload() {
    await this.navLink('/creator/upload').click();
    await this.page.waitForURL(/\/creator\/upload/);
  }

  async navigateToAnalytics() {
    await this.navLink('/creator/analytics').click();
    await this.page.waitForURL(/\/creator\/analytics/);
  }

  async navigateToSubscriptions() {
    await this.navLink('/creator/subscriptions').click();
    await this.page.waitForURL(/\/creator\/subscriptions/);
  }

  async navigateToMessages() {
    await this.navLink('/messages').click();
    await this.page.waitForURL(/\/messages/);
  }

  async logout() {
    // "Déconnexion" lives in the avatar menu
    await this.page.getByTestId('user-menu-trigger').click();
    await this.page.getByTestId('logout-button').click();
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
}
