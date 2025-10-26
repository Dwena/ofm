import { test as base, expect } from '@playwright/test';
import { AuthPage } from '../pages/auth.page';
import { DashboardPage } from '../pages/dashboard.page';

type AuthFixtures = {
  authPage: AuthPage;
  dashboardPage: DashboardPage;
  authenticatedCreator: void;
  authenticatedSubscriber: void;
};

export const test = base.extend<AuthFixtures>({
  authPage: async ({ page }, use) => {
    const authPage = new AuthPage(page);
    await use(authPage);
  },

  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await use(dashboardPage);
  },

  authenticatedCreator: async ({ page }, use) => {
    // Login as creator
    const authPage = new AuthPage(page);
    await authPage.goto();
    await authPage.login(
      process.env.TEST_CREATOR_EMAIL || 'creator@test.com',
      process.env.TEST_CREATOR_PASSWORD || 'Password123!'
    );

    // Wait for redirect to dashboard
    await page.waitForURL(/\/creator\/dashboard/);

    await use();

    // Logout after test
    await page.click('button:has-text("Déconnexion")');
  },

  authenticatedSubscriber: async ({ page }, use) => {
    // Login as subscriber
    const authPage = new AuthPage(page);
    await authPage.goto();
    await authPage.login(
      process.env.TEST_SUBSCRIBER_EMAIL || 'subscriber@test.com',
      process.env.TEST_SUBSCRIBER_PASSWORD || 'Password123!'
    );

    // Wait for redirect to feed
    await page.waitForURL(/\/feed/);

    await use();

    // Logout after test
    await page.click('button:has-text("Déconnexion")');
  },
});

export { expect };
