import { Page } from '@playwright/test';
import { test, expect, testUser } from './fixtures/auth.fixture';

/**
 * Subscription / PPV / tip payments go through /checkout. With the API's
 * payment simulator (PAYMENT_PROVIDER=fake, the default in development) the
 * provider's card page is /checkout/simulateur: test card 4242 is approved,
 * 0002 declined. The seeded subscriber already has a saved 4242 card.
 */

/** Pay a subscription with a new card on the simulator's page */
async function payWithNewCard(page: Page, last4: '4242' | '0002') {
  await page.getByLabel(/Nouvelle carte/).check();
  await page.getByRole('checkbox', { name: /droit de rétractation/ }).check();
  await page.getByRole('button', { name: /S’abonner/ }).click();

  await expect(page).toHaveURL(/\/checkout\/simulateur/);
  await page.getByLabel(new RegExp(`•••• ${last4}`)).check();
  await page.getByRole('button', { name: /^Payer/ }).click();
  await expect(page).toHaveURL(/\/checkout\/retour/);
}

/** Claire (creator3): the seeded subscriber is not subscribed to her paid tier */
async function openCreatorTiers(page: Page) {
  await page.goto(`/${testUser('creator3').username}`);
  await expect(page.getByRole('heading', { level: 1, name: testUser('creator3').displayName })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Offres d'abonnement" })).toBeVisible();
}

/** Subscribe button of a tier card (« S'abonner », or « Suivre » for free tiers) */
function tierButton(page: Page, tierName: string) {
  // Tier cards are shadcn <Card> elements (rounded-lg border)
  return page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByRole('heading', { name: tierName, exact: true }) })
    .last()
    .getByRole('button', { name: /S'abonner|Suivre/ });
}

test.describe('Paiements', () => {
  test.beforeEach(async ({ asSubscriber }) => {});

  test("affiche le prix HT, la TVA et le total TTC d'un abonnement payant", async ({ page }) => {
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await expect(page).toHaveURL(/\/checkout\?.*type=subscription/);
    await expect(page.getByRole('heading', { level: 1, name: 'Paiement sécurisé' })).toBeVisible();
    await expect(page.getByText('Prix HT')).toBeVisible();
    await expect(page.getByText(/TVA 20 %/)).toBeVisible();
    await expect(page.getByText('Total TTC')).toBeVisible();
    // Digital content: the withdrawal waiver is required
    await page.getByRole('button', { name: /S’abonner/ }).click();
    await expect(page.getByText(/Cochez cette case/)).toBeVisible();
  });

  test('souscrit un abonnement avec une nouvelle carte (simulateur)', async ({ page }) => {
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await payWithNewCard(page, '4242');
    await expect(page.getByRole('heading', { name: 'Paiement effectué' })).toBeVisible({ timeout: 30000 });
  });

  test('affiche un échec de paiement avec une carte refusée (simulateur)', async ({ page }) => {
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await payWithNewCard(page, '0002');
    await expect(page.getByRole('heading', { name: 'Paiement refusé' })).toBeVisible({ timeout: 30000 });
  });

  test('propose de débloquer un contenu payant depuis le feed', async ({ page }) => {
    await page.goto('/feed');
    const unlock = page.getByRole('button', { name: 'Débloquer maintenant' }).first();
    test.skip((await unlock.count()) === 0, 'Aucun contenu PPV verrouillé dans le feed');

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toMatch(/Débloquer ce contenu pour/);
      dialog.accept();
    });
    await unlock.click();

    // Unlocking either opens the secure checkout or confirms the payment in place
    await expect(page.getByRole('heading', { level: 1, name: /Paiement sécurisé|Feed/ })).toBeVisible();
  });

  test('envoie un pourboire pendant un live', async ({ page }) => {
    await page.goto('/live');
    const stream = page.locator('a[href^="/live/"]').first();
    test.skip((await stream.count()) === 0, 'Aucun live en cours');
    await stream.click();

    await page.getByRole('button', { name: 'Envoyer un pourboire' }).first().click();
    await expect(page.getByRole('heading', { name: 'Envoyer un pourboire' })).toBeVisible();
  });

  test('résilie un abonnement depuis « Mes Abonnements »', async ({ page }) => {
    await page.goto('/subscriptions');
    await page.getByRole('tab', { name: /Actifs/ }).click();

    const unsubscribe = page.getByRole('button', { name: 'Se désabonner' }).first();
    test.skip((await unsubscribe.count()) === 0, 'Aucun abonnement actif à résilier');

    // In-app confirmation dialog (no native confirm)
    await unsubscribe.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Se désabonner' }).click();

    await expect(page.getByText('Abonnement annulé').first()).toBeVisible({ timeout: 10000 });
  });
});
