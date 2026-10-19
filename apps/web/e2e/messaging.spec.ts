import { Browser, Page } from '@playwright/test';
import { test, expect, loginAs, testUser, TestRole } from './fixtures/auth.fixture';
import { pngFile } from './fixtures/files';

/**
 * Real-time messaging between the seeded creator and subscriber.
 * Tests that need an existing conversation between both accounts are
 * skipped when there is none (they do not create one through the
 * « Nouveau message » picker, to keep the seeded data unchanged).
 */

const MESSAGE_INPUT = 'Tapez votre message...';

async function openMessages(browser: Browser, role: TestRole) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await loginAs(page, role);
  await page.goto('/messages');
  await expect(page.getByRole('heading', { level: 2, name: 'Messages' })).toBeVisible();
  return { context, page, user };
}

/** Conversation rows are clickable cards in the left column, labelled with the display name */
function conversationWith(page: Page, name: string) {
  return page.locator('.cursor-pointer').filter({ hasText: name }).first();
}

async function openConversation(page: Page, name: string) {
  const conversation = conversationWith(page, name);
  if ((await conversation.count()) === 0) return false;
  await conversation.click();
  await expect(page.getByPlaceholder(MESSAGE_INPUT)).toBeVisible();
  return true;
}

async function waitForRealtime(page: Page) {
  await expect(page.getByText('En ligne', { exact: true }).first()).toBeVisible({ timeout: 10000 });
}

test.describe('Messagerie', () => {
  test('envoie et reçoit des messages en temps réel', async ({ browser }) => {
    const creator = await openMessages(browser, 'creator');
    const subscriber = await openMessages(browser, 'subscriber');

    try {
      await waitForRealtime(subscriber.page);
      await waitForRealtime(creator.page);

      const hasConversation =
        (await openConversation(subscriber.page, creator.user.displayName)) &&
        (await openConversation(creator.page, subscriber.user.displayName));
      test.skip(!hasConversation, 'Aucune conversation entre le créateur et l’abonné de test');

      const message = `Bonjour depuis les tests E2E ${Date.now()}`;
      const input = subscriber.page.getByPlaceholder(MESSAGE_INPUT);
      await input.fill(message);
      await input.press('Enter');

      await expect(subscriber.page.getByText(message).last()).toBeVisible({ timeout: 5000 });
      await expect(creator.page.getByText(message).last()).toBeVisible({ timeout: 10000 });

      const reply = `Merci pour votre message ${Date.now()}`;
      const replyInput = creator.page.getByPlaceholder(MESSAGE_INPUT);
      await replyInput.fill(reply);
      await replyInput.press('Enter');

      await expect(subscriber.page.getByText(reply).last()).toBeVisible({ timeout: 10000 });
    } finally {
      await creator.context.close();
      await subscriber.context.close();
    }
  });

  test("affiche l'indicateur de saisie", async ({ browser }) => {
    const creator = await openMessages(browser, 'creator');
    const subscriber = await openMessages(browser, 'subscriber');

    try {
      await waitForRealtime(subscriber.page);
      const hasConversation =
        (await openConversation(subscriber.page, creator.user.displayName)) &&
        (await openConversation(creator.page, subscriber.user.displayName));
      test.skip(!hasConversation, 'Aucune conversation entre le créateur et l’abonné de test');

      await subscriber.page.getByPlaceholder(MESSAGE_INPUT).pressSequentially('Test', { delay: 50 });

      // Typing indicator: three bouncing dots in the conversation
      await expect(creator.page.locator('.animate-bounce').first()).toBeVisible({ timeout: 5000 });
      await expect(creator.page.locator('.animate-bounce')).toHaveCount(0, { timeout: 10000 });
    } finally {
      await creator.context.close();
      await subscriber.context.close();
    }
  });

  test('envoie une image', async ({ browser }) => {
    const subscriber = await openMessages(browser, 'subscriber');

    try {
      await waitForRealtime(subscriber.page);
      const hasConversation = await openConversation(subscriber.page, testUser('creator').displayName);
      test.skip(!hasConversation, 'Aucune conversation pour l’abonné de test');

      await subscriber.page.locator('form input[type="file"]').setInputFiles(pngFile('message.png'));
      const send = subscriber.page.locator('form button[type="submit"]');
      await expect(send).toBeEnabled({ timeout: 15000 });
      await send.click();

      await expect(subscriber.page.locator('.overflow-y-auto img').last()).toBeVisible({ timeout: 15000 });
    } finally {
      await subscriber.context.close();
    }
  });

  test('ouvre une conversation non lue', async ({ asCreator, page }) => {
    await page.goto('/messages');
    const unread = page.locator('.cursor-pointer').filter({ has: page.locator('.bg-destructive') }).first();
    test.skip((await unread.count()) === 0, 'Aucune conversation non lue');

    await unread.click();
    await expect(page.getByPlaceholder(MESSAGE_INPUT)).toBeVisible();
    await expect(unread.locator('.bg-destructive')).toHaveCount(0, { timeout: 10000 });
  });

  // Not implemented in the messaging UI yet
  test.fixme('supprimer un message', async () => {});
  test.fixme('rechercher dans les messages', async () => {});
  test.fixme('bloquer un utilisateur depuis la messagerie', async () => {});
});
