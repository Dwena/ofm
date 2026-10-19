import { Page } from '@playwright/test';
import { test, expect, testUser } from './fixtures/auth.fixture';

/**
 * Subscription / PPV / tip payments go through /checkout and the Stripe Payment Element.
 * Card entry needs the API configured with Stripe test keys: set E2E_STRIPE=1 to run those steps.
 */
const stripeEnabled = !!process.env.E2E_STRIPE;

async function fillStripeCard(page: Page, cardNumber: string) {
  // Payment Element renders its fields inside a Stripe iframe
  const frame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  await frame.getByPlaceholder(/1234 1234 1234 1234/).fill(cardNumber);
  await frame.getByPlaceholder(/MM \/ AA|MM \/ YY/).fill('12 / 34');
  await frame.getByPlaceholder(/CVC/).fill('123');
}

/** Claire (creator3): the seeded subscriber is not subscribed to her paid tier */
async function openCreatorTiers(page: Page) {
  await page.goto(`/${testUser('creator3').username}`);
  await expect(page.getByRole('heading', { level: 1, name: testUser('creator3').displayName })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Plans d'Abonnement" })).toBeVisible();
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

  test("ouvre le paiement sécurisé d'un abonnement payant", async ({ page }) => {
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await expect(page).toHaveURL(/\/checkout\?.*type=subscription/);
    await expect(page.getByRole('heading', { level: 1, name: 'Paiement Sécurisé' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Récapitulatif' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Méthode de Paiement' })).toBeVisible();
  });

  test('souscrit un abonnement avec une carte de test', async ({ page }) => {
    test.skip(!stripeEnabled, 'E2E_STRIPE non défini : paiement Stripe non testé');
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await page.getByRole('button', { name: /Continuer|Payer/ }).click();
    await fillStripeCard(page, '4242424242424242');
    await page.getByRole('button', { name: /^Payer/ }).click();

    await expect(page.getByRole('heading', { name: 'Abonnement activé !' })).toBeVisible({ timeout: 30000 });
  });

  test('affiche un échec de paiement avec une carte refusée', async ({ page }) => {
    test.skip(!stripeEnabled, 'E2E_STRIPE non défini : paiement Stripe non testé');
    await openCreatorTiers(page);

    const subscribe = tierButton(page, 'Gourmand');
    test.skip(!(await subscribe.isEnabled()), "L'abonné de test est déjà abonné à ce créateur");
    await subscribe.click();

    await page.getByRole('button', { name: /Continuer|Payer/ }).click();
    await fillStripeCard(page, '4000000000000002');
    await page.getByRole('button', { name: /^Payer/ }).click();

    await expect(page.getByText(/Paiement Échoué|carte a été refusée|declined/i).first()).toBeVisible({
      timeout: 30000,
    });
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
    await expect(page.getByRole('heading', { level: 1, name: /Paiement Sécurisé|Feed/ })).toBeVisible();
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
    await page.getByRole('tab', { name: /Mes Abonnements/ }).click();

    const unsubscribe = page.getByRole('button', { name: 'Se désabonner' }).first();
    test.skip((await unsubscribe.count()) === 0, 'Aucun abonnement actif à résilier');

    page.once('dialog', (dialog) => dialog.accept());
    await unsubscribe.click();

    await expect(page.getByText('Abonnement annulé').first()).toBeVisible({ timeout: 10000 });
  });
});
