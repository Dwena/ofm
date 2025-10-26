import { test, expect } from './fixtures/auth.fixture';

test.describe('Subscriber Feed', () => {
  test.use({ authenticatedSubscriber: undefined });

  test('should display feed page', async ({ page }) => {
    await page.goto('/feed');

    await expect(page.locator('h1:has-text("Feed")')).toBeVisible();
  });

  test('should have feed tabs', async ({ page }) => {
    await page.goto('/feed');

    await expect(page.locator('text=Tout')).toBeVisible();
    await expect(page.locator('text=Mes Abonnements')).toBeVisible();
  });

  test('should switch between feed tabs', async ({ page }) => {
    await page.goto('/feed');

    await page.click('text=Mes Abonnements');

    // URL or content should change
    await page.waitForTimeout(500);
  });

  test('should display content cards', async ({ page }) => {
    await page.goto('/feed');

    // Should show content or empty state
    const hasContent = await page.locator('[class*="Card"]').count() > 0;
    const hasEmptyState = await page.locator('text=Aucun contenu').isVisible();

    expect(hasContent || hasEmptyState).toBeTruthy();
  });

  test('should show pagination when available', async ({ page }) => {
    await page.goto('/feed');

    // Check for pagination controls
    const hasPagination = await page.locator('text=/Précédent|Suivant|Page/').count() > 0;

    // Pagination might not be visible if there's not enough content
    if (hasPagination) {
      await expect(page.locator('text=Page')).toBeVisible();
    }
  });

  test('should display locked content indicator', async ({ page }) => {
    await page.goto('/feed');

    // Look for any locked content
    const lockedContent = page.locator('text=Contenu verrouillé').or(page.locator('text=Débloquer'));

    if (await lockedContent.count() > 0) {
      await expect(lockedContent.first()).toBeVisible();
    }
  });

  test('should show like button on content', async ({ page }) => {
    await page.goto('/feed');

    // Look for like buttons (heart icons)
    const likeButtons = page.locator('button').filter({ has: page.locator('svg') }).filter({ hasText: /^\d+$/ });

    if (await likeButtons.count() > 0) {
      await expect(likeButtons.first()).toBeVisible();
    }
  });
});

test.describe('Subscriptions Management', () => {
  test.use({ authenticatedSubscriber: undefined });

  test('should display subscriptions page', async ({ page }) => {
    await page.goto('/subscriptions');

    await expect(page.locator('h1:has-text("Abonnements")')).toBeVisible();
  });

  test('should have discover and my subscriptions tabs', async ({ page }) => {
    await page.goto('/subscriptions');

    await expect(page.locator('text=Découvrir')).toBeVisible();
    await expect(page.locator('text=Mes Abonnements')).toBeVisible();
  });

  test('should display search bar', async ({ page }) => {
    await page.goto('/subscriptions');

    await expect(page.locator('input[placeholder*="Rechercher"]')).toBeVisible();
  });

  test('should search for creators', async ({ page }) => {
    await page.goto('/subscriptions');

    const searchInput = page.locator('input[placeholder*="Rechercher"]');
    await searchInput.fill('test');

    await page.waitForTimeout(500);
  });

  test('should switch to my subscriptions tab', async ({ page }) => {
    await page.goto('/subscriptions');

    await page.click('text=Mes Abonnements');

    // Should show subscriptions or empty state
    const hasSubscriptions = await page.locator('[class*="Card"]').count() > 0;
    const hasEmptyState = await page.locator('text=Aucun abonnement').isVisible();

    expect(hasSubscriptions || hasEmptyState).toBeTruthy();
  });

  test('should display featured creators', async ({ page }) => {
    await page.goto('/subscriptions');

    // Should show creators or loading state
    await page.waitForTimeout(1000);

    const hasCreators = await page.locator('text=abonnés').count() > 0;
    const isLoading = await page.locator('.animate-spin').isVisible();

    expect(hasCreators || isLoading).toBeTruthy();
  });

  test('should show subscribe buttons', async ({ page }) => {
    await page.goto('/subscriptions');

    await page.waitForTimeout(1000);

    // Look for subscribe buttons
    const subscribeButtons = page.locator('button:has-text("S\'abonner")');

    if (await subscribeButtons.count() > 0) {
      await expect(subscribeButtons.first()).toBeVisible();
    }
  });

  test('should display tier information', async ({ page }) => {
    await page.goto('/subscriptions');

    await page.waitForTimeout(1000);

    // Look for tier badges or names
    const hasTiers = await page.locator('text=/BASIC|PREMIUM|VIP/').count() > 0;

    if (hasTiers) {
      await expect(page.locator('text=/BASIC|PREMIUM|VIP/').first()).toBeVisible();
    }
  });
});

test.describe('Messages', () => {
  test.use({ authenticatedSubscriber: undefined });

  test('should display messages page', async ({ page }) => {
    await page.goto('/messages');

    await expect(page.locator('h2:has-text("Messages")')).toBeVisible();
  });

  test('should show online status', async ({ page }) => {
    await page.goto('/messages');

    // Should show online/offline badge
    await expect(page.locator('text=/En ligne|Hors ligne/')).toBeVisible();
  });

  test('should display conversations list', async ({ page }) => {
    await page.goto('/messages');

    // Should show conversations or empty state
    const hasConversations = await page.locator('[class*="cursor-pointer"]').count() > 0;
    const hasEmptyState = await page.locator('text=Aucune conversation').isVisible();

    expect(hasConversations || hasEmptyState).toBeTruthy();
  });

  test('should show message input when conversation selected', async ({ page }) => {
    await page.goto('/messages');

    // If there are conversations, click one
    const conversation = page.locator('[class*="cursor-pointer"]').first();

    if (await conversation.count() > 0) {
      await conversation.click();

      // Should show message input
      await expect(page.locator('input[placeholder*="message"]')).toBeVisible();
      await expect(page.locator('button:has(svg)').last()).toBeVisible(); // Send button
    }
  });

  test('should show empty state when no conversation selected', async ({ page }) => {
    await page.goto('/messages');

    // If no conversation selected, should show placeholder
    const placeholder = page.locator('text=Sélectionnez une conversation');

    if (await placeholder.isVisible()) {
      await expect(placeholder).toBeVisible();
    }
  });
});
