import { test, expect, testUser } from './fixtures/auth.fixture';

test.describe('Authentification', () => {
  test.describe('Connexion', () => {
    test('affiche la page de connexion', async ({ authPage, page }) => {
      await authPage.goto();
      await expect(page.getByText('Connectez-vous à votre compte')).toBeVisible();
      await expect(authPage.emailInput).toBeVisible();
      await expect(authPage.passwordInput).toBeVisible();
      await expect(authPage.loginButton).toHaveText('Se connecter');
    });

    test('connecte un créateur et redirige vers son dashboard', async ({ authPage, page }) => {
      const creator = testUser('creator');
      await authPage.goto();
      await authPage.login(creator.email, creator.password);

      await expect(page).toHaveURL(/\/creator\/dashboard/, { timeout: 10000 });
    });

    test('connecte un abonné et redirige vers le feed', async ({ authPage, page }) => {
      const subscriber = testUser('subscriber');
      await authPage.goto();
      await authPage.login(subscriber.email, subscriber.password);

      await expect(page).toHaveURL(/\/feed/, { timeout: 10000 });
    });

    test('affiche une erreur avec des identifiants invalides', async ({ authPage }) => {
      await authPage.goto();
      await authPage.login('invalid@test.com', 'wrongpassword');

      await expect(authPage.loginError).toHaveText(/Email ou mot de passe incorrect|Trop de tentatives/, {
        timeout: 5000,
      });
    });

    test('exige un email', async ({ authPage }) => {
      await authPage.goto();
      await authPage.passwordInput.fill('password123');
      await authPage.loginButton.click();

      // Native `required` validation keeps the form from submitting
      await expect(authPage.emailInput).toBeFocused();
      expect(await authPage.emailInput.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    });

    test("navigue vers la page d'inscription", async ({ authPage, page }) => {
      await authPage.goto();
      await authPage.goToRegister();

      await expect(page).toHaveURL(/\/register/);
    });
  });

  test.describe('Inscription', () => {
    test("affiche le formulaire d'inscription", async ({ authPage, page }) => {
      await page.goto('/register');

      await expect(page.getByTestId('register-role-subscriber')).toBeVisible();
      await expect(page.getByTestId('register-role-creator')).toBeVisible();
      await expect(authPage.registerEmailInput).toBeVisible();
      await expect(authPage.usernameInput).toBeVisible();
      await expect(authPage.registerPasswordInput).toBeVisible();
      await expect(authPage.passwordConfirmInput).toBeVisible();
      await expect(authPage.registerSubmitButton).toHaveText("S'inscrire");
    });

    test('crée un compte créateur', async ({ authPage, page }) => {
      const timestamp = Date.now();
      await authPage.register(`creator-${timestamp}@test.com`, `creator${timestamp}`, 'Password123!', 'CREATOR');

      // Registration logs the user in (or asks to verify the email first)
      await expect(page).toHaveURL(/\/(login|verify-email|creator\/dashboard)/, { timeout: 10000 });
    });

    test('crée un compte abonné', async ({ authPage, page }) => {
      const timestamp = Date.now();
      await authPage.register(`subscriber-${timestamp}@test.com`, `subscriber${timestamp}`, 'Password123!', 'SUBSCRIBER');

      await expect(page).toHaveURL(/\/(login|verify-email|feed)/, { timeout: 10000 });
    });

    test('signale des mots de passe différents', async ({ authPage, page }) => {
      await page.goto('/register');
      await authPage.fillRegistration('test@test.com', 'testuser', 'Password123!', 'DifferentPassword123!');
      await authPage.registerSubmitButton.click();

      await expect(page.getByTestId('register-password-confirm-error')).toHaveText('Les mots de passe ne correspondent pas');
    });

    test('refuse un mot de passe trop court', async ({ authPage, page }) => {
      await page.goto('/register');
      await authPage.fillRegistration('test@test.com', 'testuser', 'weak');
      await authPage.registerSubmitButton.click();

      await expect(page.getByTestId('register-password-error')).toHaveText(
        'Le mot de passe doit contenir au moins 8 caractères.',
      );
      await expect(page).toHaveURL(/\/register/);
    });
  });

  test.describe('Session', () => {
    test('conserve la session après rechargement', async ({ asCreator, page }) => {
      await page.reload();

      await expect(page).toHaveURL(/\/creator\/dashboard/);
      await expect(page.getByTestId('main-nav')).toBeVisible();
    });

    test('se déconnecte', async ({ asCreator, page }) => {
      await page.getByTestId('user-menu-trigger').click();
      await page.getByTestId('logout-button').click();

      await expect(page).toHaveURL(/\/login/);
    });

    test('redirige vers la connexion sans session', async ({ page }) => {
      await page.goto('/creator/dashboard');

      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    });
  });
});
