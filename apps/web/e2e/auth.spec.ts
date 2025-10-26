import { test, expect } from './fixtures/auth.fixture';

test.describe('Authentication', () => {
  test.describe('Login', () => {
    test('should display login page', async ({ authPage }) => {
      await authPage.goto();
      await expect(authPage.emailInput).toBeVisible();
      await expect(authPage.passwordInput).toBeVisible();
      await expect(authPage.loginButton).toBeVisible();
    });

    test('should login with valid credentials', async ({ authPage, page }) => {
      await authPage.goto();
      await authPage.login('creator@test.com', 'Password123!');

      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/(creator\/dashboard|feed)/, { timeout: 5000 });
    });

    test('should show error with invalid credentials', async ({ authPage }) => {
      await authPage.goto();
      await authPage.login('invalid@test.com', 'wrongpassword');

      // Should show error message
      await expect(authPage.page.locator('text=/identifiants|incorrects|invalid/i')).toBeVisible({ timeout: 3000 });
    });

    test('should show validation error for empty email', async ({ authPage }) => {
      await authPage.goto();
      await authPage.passwordInput.fill('password123');
      await authPage.loginButton.click();

      // Should show validation error
      await expect(authPage.emailInput).toBeFocused();
    });

    test('should navigate to register page', async ({ authPage, page }) => {
      await authPage.goto();
      await authPage.goToRegister();

      await expect(page).toHaveURL(/\/register/);
    });
  });

  test.describe('Registration', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/register');

      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[name="username"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('should register new creator account', async ({ authPage, page }) => {
      const timestamp = Date.now();
      const email = `creator-${timestamp}@test.com`;
      const username = `creator${timestamp}`;

      await authPage.register(email, username, 'Password123!', 'CREATOR');

      // Should redirect after successful registration
      await expect(page).toHaveURL(/\/(login|creator\/dashboard)/, { timeout: 5000 });
    });

    test('should register new subscriber account', async ({ authPage, page }) => {
      const timestamp = Date.now();
      const email = `subscriber-${timestamp}@test.com`;
      const username = `subscriber${timestamp}`;

      await authPage.register(email, username, 'Password123!', 'SUBSCRIBER');

      // Should redirect after successful registration
      await expect(page).toHaveURL(/\/(login|feed)/, { timeout: 5000 });
    });

    test('should show error for mismatched passwords', async ({ authPage, page }) => {
      await page.goto('/register');

      await authPage.emailInput.fill('test@test.com');
      await authPage.usernameInput.fill('testuser');
      await authPage.passwordInput.fill('Password123!');
      await authPage.passwordConfirmInput.fill('DifferentPassword123!');
      await authPage.registerSubmitButton.click();

      // Should show validation error
      await expect(page.locator('text=/mot de passe.*correspondent|passwords.*match/i')).toBeVisible();
    });

    test('should show error for weak password', async ({ authPage, page }) => {
      await page.goto('/register');

      await authPage.emailInput.fill('test@test.com');
      await authPage.usernameInput.fill('testuser');
      await authPage.passwordInput.fill('weak');
      await authPage.passwordConfirmInput.fill('weak');
      await authPage.registerSubmitButton.click();

      // Should show validation error
      await expect(page.locator('text=/mot de passe.*faible|password.*weak|caractères|characters/i')).toBeVisible();
    });
  });

  test.describe('Authenticated Session', () => {
    test('should maintain session after page reload', async ({ authenticatedCreator, page }) => {
      await page.reload();

      // Should still be on dashboard
      await expect(page).toHaveURL(/\/creator\/dashboard/);
    });

    test('should logout successfully', async ({ authenticatedCreator, page }) => {
      await page.click('button:has-text("Déconnexion")');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });

    test('should redirect to login when accessing protected route without auth', async ({ page }) => {
      await page.goto('/creator/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
    });
  });
});
