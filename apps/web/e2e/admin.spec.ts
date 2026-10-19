import { test, expect, loginAs } from './fixtures/auth.fixture';

test.describe('Back-office administrateur', () => {
  test.beforeEach(async ({ asAdmin }) => {});

  test('affiche le sous-menu admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: "Panneau d'administration" })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Administration' });
    for (const label of [
      'Tableau de bord',
      'Analytique',
      'Utilisateurs',
      'Signalements',
      'Contenus',
      'Modération',
      'Journaux',
      'Paramètres',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('affiche l’analytique de la plateforme', async ({ page }) => {
    await page.goto('/admin/analytics');

    await expect(page.getByRole('heading', { level: 1, name: 'Analytique' })).toBeVisible();
    for (const id of ['kpi-revenue', 'kpi-platform-fees', 'kpi-new-users', 'kpi-active-subscriptions', 'kpi-content-uploads']) {
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 10000 });
    }
    await expect(page.getByRole('heading', { name: 'Revenus et commissions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meilleurs créateurs' })).toBeVisible();

    // Changing the period refetches the series
    await page.getByRole('combobox', { name: 'Période' }).click();
    await page.getByRole('option', { name: '12 derniers mois' }).click();
    await expect(page.getByRole('combobox', { name: 'Regroupement' })).toHaveText('Par mois');
  });

  test('affiche et enregistre les paramètres de la plateforme', async ({ page }) => {
    await page.goto('/admin/settings');

    await expect(page.getByRole('heading', { level: 1, name: 'Paramètres de la plateforme' })).toBeVisible();
    const fee = page.getByLabel('Commission de la plateforme (%)');
    await expect(fee).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Versement minimum (€)')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Inscriptions ouvertes' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Mode maintenance' })).toHaveAttribute('aria-checked', 'false');

    const save = page.getByRole('button', { name: 'Enregistrer' });
    await expect(save).toBeDisabled();

    // Change the fee and put it back so the platform is left as it was
    const original = await fee.inputValue();
    const next = original === '20' ? '19' : '20';
    await fee.fill(next);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Paramètres enregistrés').first()).toBeVisible();
    await expect(page.getByText('Personnalisé').first()).toBeVisible();

    await fee.fill(original);
    await save.click();
    await expect(save).toBeDisabled({ timeout: 10000 });
  });

  test('refuse une commission hors limites', async ({ page }) => {
    await page.goto('/admin/settings');
    const fee = page.getByLabel('Commission de la plateforme (%)');
    await fee.fill('80');

    await expect(page.getByText('Entre 0 et 50 %')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  test('affiche les signalements avec les statuts admin', async ({ page }) => {
    await page.goto('/admin/reports');

    await expect(page.getByRole('heading', { level: 1, name: 'Signalements' })).toBeVisible();
    await expect(page.getByTestId('reports-queue')).toBeVisible();
    await expect(
      page.getByTestId('report-item').first().or(page.getByText('Aucun signalement à afficher')),
    ).toBeVisible({ timeout: 10000 });
  });

  test('la modération réutilise la même file de signalements', async ({ page }) => {
    await page.goto('/admin/moderation');

    await expect(page.getByRole('heading', { level: 1, name: 'Modération' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Signalements/ })).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('reports-queue')).toBeVisible();
  });

  test('affiche les statistiques de modération réelles', async ({ page }) => {
    await page.goto('/admin/moderation');
    await page.getByRole('tab', { name: 'Statistiques' }).click();

    const stats = page.getByTestId('moderation-stats');
    await expect(stats).toBeVisible({ timeout: 10000 });
    await expect(stats.getByRole('heading', { name: 'Temps moyen de traitement' })).toBeVisible();
    await expect(stats.getByRole('heading', { name: 'Signalements reçus et traités' })).toBeVisible();
    await expect(stats.getByRole('heading', { name: 'Actions de modération' }).first()).toBeVisible();
  });

  test('affiche les journaux d’audit', async ({ page }) => {
    await page.goto('/admin/logs');

    await expect(page.getByRole('heading', { level: 1, name: "Journaux d'audit" })).toBeVisible();
    await expect(page.getByRole('table').or(page.getByText('Aucune action enregistrée'))).toBeVisible({
      timeout: 10000,
    });
  });
});

test('un abonné ne peut pas accéder au back-office', async ({ page }) => {
  await loginAs(page, 'subscriber');
  await page.goto('/admin/settings');

  await expect(page).not.toHaveURL(/\/admin/, { timeout: 10000 });
});
