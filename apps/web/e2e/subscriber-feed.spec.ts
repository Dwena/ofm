import { test, expect } from './fixtures/auth.fixture';

test.describe('Feed abonné', () => {
  test.beforeEach(async ({ asSubscriber, page }) => {
    await page.goto('/feed');
  });

  test('affiche le feed', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Feed' })).toBeVisible();
  });

  test('propose les onglets Tout / Mes Abonnements', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Tout' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mes Abonnements' })).toBeVisible();
  });

  test('bascule sur « Mes Abonnements »', async ({ page }) => {
    const tab = page.getByRole('tab', { name: 'Mes Abonnements' });
    await tab.click();

    await expect(tab).toHaveAttribute('data-state', 'active');
  });

  test('affiche des contenus ou un état vide', async ({ page }) => {
    const empty = page.getByText(/Aucun contenu (disponible|de vos abonnements)/);
    const cards = page.locator('main .rounded-lg.border');

    await expect(empty.or(cards.first())).toBeVisible({ timeout: 10000 });
  });

  test('affiche la pagination quand elle est disponible', async ({ page }) => {
    const previous = page.getByRole('button', { name: 'Précédent' });
    if (await previous.count()) {
      await expect(page.getByRole('button', { name: 'Suivant' }).first()).toBeVisible();
    }
  });

  test('indique les contenus verrouillés', async ({ page }) => {
    const locked = page.getByText('Contenu verrouillé');
    if (await locked.count()) {
      await expect(locked.first()).toBeVisible();
      // PPV content offers « Débloquer maintenant », subscriber-only content links to the creator's tiers
      const cta = page
        .getByRole('button', { name: 'Débloquer maintenant' })
        .or(page.getByRole('link', { name: "S'abonner" }));
      await expect(cta.first()).toBeVisible();
    }
  });
});

test.describe('Abonnements (abonné)', () => {
  test.beforeEach(async ({ asSubscriber, page }) => {
    await page.goto('/subscriptions');
  });

  test('affiche la page des abonnements', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Abonnements' })).toBeVisible();
  });

  test('propose les onglets Actifs / Suivis / Historique', async ({ page }) => {
    for (const name of [/Actifs/, /Suivis/, /Historique/]) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
  });

  test('renvoie vers Découvrir pour chercher des créateurs', async ({ page }) => {
    await page.getByRole('link', { name: /Découvrir/ }).first().click();
    await expect(page).toHaveURL(/\/discover/);
  });

  test('liste mes abonnements ou un état vide', async ({ page }) => {
    await page.getByRole('tab', { name: /Actifs/ }).click();

    await expect(
      page.getByRole('button', { name: /Se désabonner|Reprendre|Se réabonner/ }).first().or(page.getByText("Vous n'avez aucun abonnement actif")),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Messages (abonné)', () => {
  test.beforeEach(async ({ asSubscriber, page }) => {
    await page.goto('/messages');
  });

  test('affiche la messagerie', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 2, name: 'Messages' })).toBeVisible();
  });

  test('affiche le statut de connexion temps réel', async ({ page }) => {
    await expect(page.getByText(/^(En ligne|Hors ligne)$/).first()).toBeVisible();
  });

  test('affiche les conversations ou un état vide', async ({ page }) => {
    await expect(
      page.getByText('Aucune conversation').or(page.getByText('Sélectionnez une conversation')),
    ).toBeVisible({ timeout: 10000 });
  });

  test('ouvre une conversation et affiche la saisie', async ({ page }) => {
    const firstConversation = page.locator('.cursor-pointer').first();
    test.skip((await firstConversation.count()) === 0, 'Aucune conversation pour cet utilisateur');

    await firstConversation.click();
    await expect(page.getByPlaceholder('Tapez votre message...')).toBeVisible();
  });
});
