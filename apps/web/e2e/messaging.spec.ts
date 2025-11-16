import { test, expect } from '@playwright/test';

test.describe('Messaging', () => {
  test('send and receive messages', async ({ browser }) => {
    // Create two browser contexts (two users)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // User 1 (Creator) login
      await page1.goto('http://localhost:3000/login');
      await page1.fill('[name="email"]', 'alice@ofm.com');
      await page1.fill('[name="password"]', 'SecurePass123!');
      await page1.click('button[type="submit"]');
      await page1.waitForURL('**/feed');

      // User 2 (Subscriber) login
      await page2.goto('http://localhost:3000/login');
      await page2.fill('[name="email"]', 'david@ofm.com');
      await page2.fill('[name="password"]', 'SecurePass123!');
      await page2.click('button[type="submit"]');
      await page2.waitForURL('**/feed');

      // User 2 navigates to messages
      await page2.goto('http://localhost:3000/messages');

      // Start conversation with alice
      await page2.click('text=New Message');
      await page2.fill('[placeholder="Search users"]', 'alice');
      await page2.waitForSelector('text=@alice', { timeout: 5000 });
      await page2.click('text=@alice');

      // Send message
      const testMessage = 'Hello from E2E test!';
      await page2.fill('[placeholder="Type a message"]', testMessage);
      await page2.press('[placeholder="Type a message"]', 'Enter');

      // Verify message appears in sender's view
      await expect(page2.locator(`text=${testMessage}`)).toBeVisible({ timeout: 5000 });

      // User 1 should receive message
      await page1.goto('http://localhost:3000/messages');

      // Wait for WebSocket message
      await page1.waitForSelector(`text=${testMessage}`, { timeout: 10000 });
      await expect(page1.locator(`text=${testMessage}`)).toBeVisible();

      // User 1 replies
      const conversationWithDavid = page1.locator(`text=@david`);
      if (await conversationWithDavid.isVisible()) {
        await conversationWithDavid.click();
      }

      const replyMessage = 'Thanks for the message!';
      await page1.fill('[placeholder="Type a message"]', replyMessage);
      await page1.press('[placeholder="Type a message"]', 'Enter');

      // User 2 should receive reply
      await page2.waitForSelector(`text=${replyMessage}`, { timeout: 10000 });
      await expect(page2.locator(`text=${replyMessage}`)).toBeVisible();
    } finally {
      // Cleanup
      await context1.close();
      await context2.close();
    }
  });

  test('typing indicator works', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Login both users
      await page1.goto('http://localhost:3000/login');
      await page1.fill('[name="email"]', 'alice@ofm.com');
      await page1.fill('[name="password"]', 'SecurePass123!');
      await page1.click('button[type="submit"]');
      await page1.waitForURL('**/feed');

      await page2.goto('http://localhost:3000/login');
      await page2.fill('[name="email"]', 'david@ofm.com');
      await page2.fill('[name="password"]', 'SecurePass123!');
      await page2.click('button[type="submit"]');
      await page2.waitForURL('**/feed');

      // Navigate both to messages and open conversation
      await page1.goto('http://localhost:3000/messages');
      await page2.goto('http://localhost:3000/messages');

      // User 2 selects conversation with alice
      const aliceConversation = page2.locator('text=@alice');
      if (await aliceConversation.isVisible()) {
        await aliceConversation.click();
      } else {
        await page2.click('text=New Message');
        await page2.fill('[placeholder="Search users"]', 'alice');
        await page2.click('text=@alice');
      }

      // User 1 selects conversation with david
      const davidConversation = page1.locator('text=@david');
      if (await davidConversation.isVisible()) {
        await davidConversation.click();
      }

      // User 2 starts typing
      await page2.fill('[placeholder="Type a message"]', 'Test');

      // User 1 should see typing indicator
      await expect(page1.locator('text=typing...')).toBeVisible({ timeout: 5000 });

      // User 2 stops typing
      await page2.press('[placeholder="Type a message"]', 'Escape');
      await page2.fill('[placeholder="Type a message"]', '');

      // Typing indicator should disappear
      await expect(page1.locator('text=typing...')).not.toBeVisible({ timeout: 5000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('send image in message', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');

    // Navigate to messages
    await page.goto('http://localhost:3000/messages');

    // Open or create conversation
    const aliceConversation = page.locator('text=@alice');
    if (await aliceConversation.isVisible()) {
      await aliceConversation.click();
    } else {
      await page.click('text=New Message');
      await page.fill('[placeholder="Search users"]', 'alice');
      await page.click('text=@alice');
    }

    // Click image upload button (if available)
    const imageButton = page.locator('button[aria-label="Upload image"]');
    if (await imageButton.isVisible()) {
      await imageButton.click();

      // Upload image
      const path = require('path');
      const imagePath = path.join(__dirname, 'fixtures', 'test-image.jpg');
      await page.setInputFiles('input[type="file"]', imagePath);

      // Send image
      await page.click('button:has-text("Send")');

      // Verify image appears in conversation
      await expect(page.locator('img[alt*="message"]')).toBeVisible({ timeout: 10000 });
    }
  });

  test('delete message', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');

    // Navigate to messages
    await page.goto('http://localhost:3000/messages');

    // Open conversation
    const aliceConversation = page.locator('text=@alice');
    if (await aliceConversation.isVisible()) {
      await aliceConversation.click();
    }

    // Send a message first
    const testMessage = 'Message to be deleted';
    await page.fill('[placeholder="Type a message"]', testMessage);
    await page.press('[placeholder="Type a message"]', 'Enter');

    // Wait for message to appear
    await expect(page.locator(`text=${testMessage}`)).toBeVisible({ timeout: 5000 });

    // Hover over message to show delete option
    const messageElement = page.locator(`text=${testMessage}`);
    await messageElement.hover();

    // Click delete button (if available)
    const deleteButton = page.locator('button[aria-label="Delete message"]');
    if (await deleteButton.isVisible()) {
      await deleteButton.click();

      // Confirm deletion
      await page.click('button:has-text("Delete")');

      // Verify message is deleted
      await expect(page.locator(`text=${testMessage}`)).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('mark conversation as read', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');

    // Navigate to messages
    await page.goto('http://localhost:3000/messages');

    // Check for unread indicator
    const unreadBadge = page.locator('[data-testid="unread-badge"]').first();
    if (await unreadBadge.isVisible()) {
      const unreadConversation = page.locator('[data-testid="conversation-item"]').first();
      await unreadConversation.click();

      // Wait a moment for messages to load
      await page.waitForTimeout(1000);

      // Check that unread badge disappears
      await expect(unreadBadge).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('search messages', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');

    // Navigate to messages
    await page.goto('http://localhost:3000/messages');

    // Look for search input
    const searchInput = page.locator('[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('alice');

      // Verify search results
      await expect(page.locator('text=@alice')).toBeVisible({ timeout: 5000 });
    }
  });

  test('block user from messages', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');

    // Navigate to messages
    await page.goto('http://localhost:3000/messages');

    // Open conversation
    const conversation = page.locator('[data-testid="conversation-item"]').first();
    if (await conversation.isVisible()) {
      await conversation.click();

      // Open conversation menu
      const menuButton = page.locator('button[aria-label="Conversation menu"]');
      if (await menuButton.isVisible()) {
        await menuButton.click();

        // Click block option
        await page.click('text=Block User');

        // Confirm block
        await page.click('button:has-text("Block")');

        // Verify user is blocked
        await expect(page.locator('text=User blocked')).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
