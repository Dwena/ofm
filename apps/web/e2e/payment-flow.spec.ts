import { test, expect } from '@playwright/test';

test.describe('Payment Flow', () => {
  test('complete subscription purchase', async ({ page }) => {
    // Login as subscriber
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    // Wait for redirect after login
    await page.waitForURL('**/feed');

    // Navigate to creator profile
    await page.goto('http://localhost:3000/alice');

    // Click subscribe button
    await page.click('text=Subscribe');

    // Select tier (wait for modal/dialog to appear)
    await page.waitForSelector('text=Premium');
    await page.click('text=Premium');

    // Wait for Stripe checkout to load
    await page.waitForSelector('iframe[name^="__privateStripeFrame"]', { timeout: 10000 });

    // Fill Stripe test card
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
    await stripeFrame.locator('[name="cardnumber"]').fill('4242424242424242');
    await stripeFrame.locator('[name="exp-date"]').fill('12/34');
    await stripeFrame.locator('[name="cvc"]').fill('123');
    await stripeFrame.locator('[name="postal"]').fill('12345');

    // Submit payment
    await page.click('button:has-text("Subscribe Now")');

    // Verify success (wait for redirect or success message)
    await expect(page.locator('text=Subscription successful')).toBeVisible({ timeout: 15000 });

    // Verify access to content
    await page.goto('http://localhost:3000/feed');
    await expect(page.locator('text=Premium Content')).toBeVisible({ timeout: 5000 });
  });

  test('send tip to creator', async ({ page }) => {
    // Login as subscriber
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/feed');

    // Navigate to creator profile
    await page.goto('http://localhost:3000/alice');

    // Click tip button
    await page.click('text=Send Tip');

    // Select amount
    await page.click('text=€10');

    // Add message (optional)
    const messageInput = page.locator('[name="message"]');
    if (await messageInput.isVisible()) {
      await messageInput.fill('Great content!');
    }

    // Submit tip
    await page.click('button:has-text("Send Tip")');

    // Verify success
    await expect(page.locator('text=Tip sent successfully')).toBeVisible({ timeout: 10000 });
  });

  test('handle payment failure gracefully', async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/feed');

    // Navigate to creator profile
    await page.goto('http://localhost:3000/alice');

    // Click subscribe button
    await page.click('text=Subscribe');
    await page.waitForSelector('text=Premium');
    await page.click('text=Premium');

    // Fill Stripe with card that will be declined
    await page.waitForSelector('iframe[name^="__privateStripeFrame"]');
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
    await stripeFrame.locator('[name="cardnumber"]').fill('4000000000000002'); // Card declined
    await stripeFrame.locator('[name="exp-date"]').fill('12/34');
    await stripeFrame.locator('[name="cvc"]').fill('123');
    await stripeFrame.locator('[name="postal"]').fill('12345');

    // Submit payment
    await page.click('button:has-text("Subscribe Now")');

    // Verify error message
    await expect(page.locator('text=Payment failed')).toBeVisible({ timeout: 10000 });
  });

  test('cancel subscription', async ({ page }) => {
    // Login as subscriber who already has a subscription
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/feed');

    // Navigate to subscriptions page
    await page.goto('http://localhost:3000/settings');
    await page.click('text=Subscriptions');

    // Find active subscription and click manage
    await page.click('text=Manage Subscription');

    // Cancel subscription
    await page.click('text=Cancel Subscription');

    // Confirm cancellation
    await page.click('button:has-text("Confirm Cancellation")');

    // Verify cancellation success
    await expect(page.locator('text=Subscription cancelled')).toBeVisible({ timeout: 10000 });
  });
});
