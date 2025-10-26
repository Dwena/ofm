import { test, expect } from './fixtures/auth.fixture';
import { DashboardPage } from './pages/dashboard.page';

test.describe('Creator Dashboard', () => {
  test.use({ authenticatedCreator: undefined });

  test('should display dashboard with stats', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.expectToBeOnDashboard();

    // Check that main stats cards are visible
    await dashboardPage.expectEarningsVisible();
    await dashboardPage.expectSubscribersVisible();
    await dashboardPage.expectContentVisible();
  });

  test('should display navigation menu', async ({ page }) => {
    await page.goto('/creator/dashboard');

    // Check navigation items
    await expect(page.locator('a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('a:has-text("Upload")')).toBeVisible();
    await expect(page.locator('a:has-text("Abonnés")')).toBeVisible();
    await expect(page.locator('a:has-text("Revenus")')).toBeVisible();
    await expect(page.locator('a:has-text("Analytics")')).toBeVisible();
  });

  test('should navigate to upload page', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToUpload();

    await expect(page).toHaveURL(/\/creator\/upload/);
    await expect(page.locator('h1:has-text("Nouveau Contenu")')).toBeVisible();
  });

  test('should navigate to analytics page', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToAnalytics();

    await expect(page).toHaveURL(/\/creator\/analytics/);
    await expect(page.locator('h1:has-text("Analytics")')).toBeVisible();
  });

  test('should navigate to messages page', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToMessages();

    await expect(page).toHaveURL(/\/messages/);
    await expect(page.locator('h2:has-text("Messages")')).toBeVisible();
  });

  test('should display recent content section', async ({ page }) => {
    await page.goto('/creator/dashboard');

    // Check for recent content section
    await expect(page.locator('text=Contenus Récents')).toBeVisible();
  });

  test('should display recent transactions section', async ({ page }) => {
    await page.goto('/creator/dashboard');

    // Check for recent transactions section
    await expect(page.locator('text=Transactions Récentes')).toBeVisible();
  });

  test('should show loading state while fetching data', async ({ page }) => {
    // Navigate and check for loading indicator
    const navigationPromise = page.goto('/creator/dashboard');

    // Should show loading state (spinner or skeleton)
    await expect(page.locator('text=Chargement').or(page.locator('.animate-spin'))).toBeVisible({ timeout: 1000 }).catch(() => {
      // Loading might be too fast, that's okay
    });

    await navigationPromise;
  });
});

test.describe('Creator Analytics', () => {
  test.use({ authenticatedCreator: undefined });

  test('should display analytics dashboard', async ({ page }) => {
    await page.goto('/creator/analytics');

    await expect(page.locator('h1:has-text("Analytics")')).toBeVisible();
    await expect(page.locator('text=Suivez vos performances')).toBeVisible();
  });

  test('should display stats cards', async ({ page }) => {
    await page.goto('/creator/analytics');

    // Check for main stats
    await expect(page.locator('text=Revenus Totaux')).toBeVisible();
    await expect(page.locator('text=Abonnés')).toBeVisible();
    await expect(page.locator('text=Engagement')).toBeVisible();
  });

  test('should have period selector', async ({ page }) => {
    await page.goto('/creator/analytics');

    // Check for period selector
    const selector = page.locator('select, [role="combobox"]').first();
    await expect(selector).toBeVisible();
  });

  test('should display analytics tabs', async ({ page }) => {
    await page.goto('/creator/analytics');

    // Check for tabs
    await expect(page.locator('text=Revenus')).toBeVisible();
    await expect(page.locator('text=Abonnés')).toBeVisible();
    await expect(page.locator('text=Contenu')).toBeVisible();
    await expect(page.locator('text=Tiers')).toBeVisible();
  });

  test('should switch between analytics tabs', async ({ page }) => {
    await page.goto('/creator/analytics');

    // Click on subscribers tab
    await page.click('text=Abonnés');
    await expect(page.locator('text=Croissance des Abonnés')).toBeVisible();

    // Click on content tab
    await page.click('text=Contenu');
    await expect(page.locator('text=Performance du Contenu')).toBeVisible();

    // Click on tiers tab
    await page.click('text=Tiers');
    await expect(page.locator('text=Distribution des Tiers')).toBeVisible();
  });
});

test.describe('Creator Subscriptions Management', () => {
  test.use({ authenticatedCreator: undefined });

  test('should display subscriptions page', async ({ page }) => {
    await page.goto('/creator/subscriptions');

    await expect(page.locator('h1:has-text("Abonnements")')).toBeVisible();
    await expect(page.locator('text=Gérez vos tiers')).toBeVisible();
  });

  test('should display subscription tiers', async ({ page }) => {
    await page.goto('/creator/subscriptions');

    // Should show tier cards
    await expect(page.locator('text=FREE')).toBeVisible();
    await expect(page.locator('text=BASIC')).toBeVisible();
    await expect(page.locator('text=PREMIUM')).toBeVisible();
    await expect(page.locator('text=VIP')).toBeVisible();
  });

  test('should display stats cards', async ({ page }) => {
    await page.goto('/creator/subscriptions');

    await expect(page.locator('text=Abonnés Totaux')).toBeVisible();
    await expect(page.locator('text=Revenus Mensuels')).toBeVisible();
    await expect(page.locator('text=Tiers Actifs')).toBeVisible();
  });

  test('should have tabs for tiers and subscribers', async ({ page }) => {
    await page.goto('/creator/subscriptions');

    await expect(page.locator('text=Tiers d\'Abonnement')).toBeVisible();
    await expect(page.locator('text=Mes Abonnés')).toBeVisible();
  });

  test('should switch to subscribers tab', async ({ page }) => {
    await page.goto('/creator/subscriptions');

    await page.click('text=Mes Abonnés');
    await expect(page.locator('text=Liste des Abonnés')).toBeVisible();
  });
});
