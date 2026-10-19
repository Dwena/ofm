import { test, expect } from './fixtures/auth.fixture';

test.describe('Dashboard créateur', () => {
  test.beforeEach(async ({ asCreator }) => {});

  test('affiche le dashboard et ses statistiques', async ({ dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.expectToBeOnDashboard();

    await dashboardPage.expectEarningsVisible();
    await dashboardPage.expectSubscribersVisible();
    await dashboardPage.expectContentVisible();
    await expect(dashboardPage.page.getByRole('heading', { name: 'Solde Disponible', exact: true })).toBeVisible();
  });

  test('affiche le menu de navigation créateur', async ({ dashboardPage }) => {
    await dashboardPage.goto();

    for (const [href, label] of [
      ['/creator/dashboard', 'Dashboard'],
      ['/creator/upload', 'Upload'],
      ['/creator/subscriptions', 'Abonnés'],
      ['/creator/earnings', 'Revenus'],
      ['/creator/analytics', 'Analytics'],
      ['/messages', 'Messages'],
    ]) {
      await expect(dashboardPage.navLink(href)).toHaveText(label);
    }
  });

  test("navigue vers la page d'upload", async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToUpload();

    await expect(page.getByRole('heading', { level: 1, name: 'Nouveau Contenu' })).toBeVisible();
  });

  test('navigue vers les analytics', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToAnalytics();

    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
  });

  test('navigue vers les messages', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();
    await dashboardPage.navigateToMessages();

    await expect(page.getByRole('heading', { level: 2, name: 'Messages' })).toBeVisible();
  });

  test('affiche les contenus récents', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();

    await expect(page.getByRole('heading', { name: 'Contenus Récents' })).toBeVisible();
  });

  test('affiche les transactions récentes', async ({ page, dashboardPage }) => {
    await dashboardPage.goto();

    await expect(page.getByRole('heading', { name: 'Transactions Récentes' })).toBeVisible();
  });
});

test.describe('Analytics créateur', () => {
  test.beforeEach(async ({ asCreator, page }) => {
    await page.goto('/creator/analytics');
  });

  test('affiche la page analytics', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByText('Suivez vos performances et optimisez votre contenu')).toBeVisible();
  });

  test('affiche les cartes de statistiques', async ({ page }) => {
    for (const title of ['Revenus ce mois', 'Abonnés actifs', 'Vues totales', 'Engagement']) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }
  });

  test('propose un sélecteur de période', async ({ page }) => {
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });

  test('affiche et change les onglets', async ({ page }) => {
    const tabs = ['Revenus', 'Abonnés', 'Engagement', 'Contenu'];
    for (const name of tabs) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
    }

    await page.getByRole('tab', { name: 'Abonnés', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Croissance des Abonnés' })).toBeVisible();

    await page.getByRole('tab', { name: 'Engagement', exact: true }).click();
    await expect(page.getByRole('heading', { name: "Statistiques d'Engagement" })).toBeVisible();

    await page.getByRole('tab', { name: 'Contenu', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Performance du Contenu' })).toBeVisible();
  });
});

test.describe('Abonnements créateur', () => {
  test.beforeEach(async ({ asCreator, page }) => {
    await page.goto('/creator/subscriptions');
  });

  test('affiche la page de gestion des abonnements', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Abonnements' })).toBeVisible();
    await expect(page.getByText("Gérez vos offres d'abonnement et vos abonnés")).toBeVisible();
  });

  test('affiche les cartes de statistiques', async ({ page }) => {
    for (const title of ['Abonnés actifs', 'Revenus mensuels', 'Offres actives']) {
      await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    }
  });

  test('affiche les offres du créateur (seed : Essentiel, Premium)', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Essentiel', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Premium', exact: true })).toBeVisible();
  });

  test('bascule sur la liste des abonnés', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Offres' })).toBeVisible();
    await page.getByRole('tab', { name: /Abonnés/ }).click();

    await expect(page).toHaveURL(/tab=subscribers/);
    await expect(page.getByRole('heading', { name: 'Liste des abonnés' })).toBeVisible();
  });

  test("/creator/tiers redirige vers l'onglet Offres", async ({ page }) => {
    await page.goto('/creator/tiers');
    await expect(page).toHaveURL(/\/creator\/subscriptions\?tab=tiers/);
    await expect(page.getByRole('heading', { level: 1, name: 'Abonnements' })).toBeVisible();
  });
});
