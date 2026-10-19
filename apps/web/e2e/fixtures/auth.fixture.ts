import { test as base, expect, Page } from '@playwright/test';
import { AuthPage } from '../pages/auth.page';
import { DashboardPage } from '../pages/dashboard.page';
import { UploadPage } from '../pages/upload.page';
import users from './test-users.json';

/**
 * Accounts created by `npm run seed` in apps/api (password: SecurePass123!).
 * Override with TEST_<ROLE>_EMAIL / TEST_<ROLE>_PASSWORD.
 */
export type TestRole = 'creator' | 'creator2' | 'creator3' | 'subscriber' | 'admin';

export function testUser(role: TestRole) {
  const prefix = `TEST_${role.toUpperCase()}`;
  return {
    email: process.env[`${prefix}_EMAIL`] || users[role].email,
    password: process.env[`${prefix}_PASSWORD`] || users[role].password,
    username: process.env[`${prefix}_USERNAME`] || users[role].username,
    displayName: process.env[`${prefix}_DISPLAY_NAME`] || users[role].displayName,
  };
}

/** Where the app redirects each role after login (see contexts/auth-context.tsx) */
const HOME_BY_ROLE: Record<TestRole, RegExp> = {
  creator: /\/creator\/dashboard/,
  creator2: /\/creator\/dashboard/,
  creator3: /\/creator\/dashboard/,
  subscriber: /\/feed/,
  admin: /\/(feed|admin)/,
};

export async function loginAs(page: Page, role: TestRole) {
  const user = testUser(role);
  const authPage = new AuthPage(page);
  await authPage.goto();
  await authPage.login(user.email, user.password);
  await page.waitForURL(HOME_BY_ROLE[role]);
  return user;
}

type AuthFixtures = {
  authPage: AuthPage;
  dashboardPage: DashboardPage;
  uploadPage: UploadPage;
  /** Request one of these in a test (or beforeEach) to start logged in */
  asCreator: void;
  asSubscriber: void;
  asAdmin: void;
};

export const test = base.extend<AuthFixtures>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  uploadPage: async ({ page }, use) => {
    await use(new UploadPage(page));
  },

  asCreator: async ({ page }, use) => {
    await loginAs(page, 'creator');
    await use();
  },

  asSubscriber: async ({ page }, use) => {
    await loginAs(page, 'subscriber');
    await use();
  },

  asAdmin: async ({ page }, use) => {
    await loginAs(page, 'admin');
    await use();
  },
});

export { expect };
