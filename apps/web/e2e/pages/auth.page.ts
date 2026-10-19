import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loginError: Locator;
  readonly registerLink: Locator;

  // Registration form (/register)
  readonly registerEmailInput: Locator;
  readonly usernameInput: Locator;
  readonly registerPasswordInput: Locator;
  readonly passwordConfirmInput: Locator;
  readonly registerSubmitButton: Locator;
  readonly registerError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.loginButton = page.getByTestId('login-submit');
    this.loginError = page.getByTestId('login-error');
    this.registerLink = page.getByTestId('register-link');

    this.registerEmailInput = page.getByTestId('register-email');
    this.usernameInput = page.getByTestId('register-username');
    this.registerPasswordInput = page.getByTestId('register-password');
    this.passwordConfirmInput = page.getByTestId('register-password-confirm');
    this.registerSubmitButton = page.getByTestId('register-submit');
    this.registerError = page.getByTestId('register-error');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async goToRegister() {
    await this.registerLink.click();
    await this.page.waitForURL(/\/register/);
  }

  async fillRegistration(email: string, username: string, password: string, confirm = password) {
    await this.registerEmailInput.fill(email);
    await this.usernameInput.fill(username);
    await this.registerPasswordInput.fill(password);
    await this.passwordConfirmInput.fill(confirm);
  }

  async register(email: string, username: string, password: string, role: 'CREATOR' | 'SUBSCRIBER' = 'CREATOR') {
    await this.page.goto('/register');
    // Account type is chosen with two toggle buttons (Abonné / Créateur)
    await this.page.getByTestId(role === 'CREATOR' ? 'register-role-creator' : 'register-role-subscriber').click();
    await this.fillRegistration(email, username, password);
    await this.registerSubmitButton.click();
  }

  async expectToBeOnDashboard() {
    await expect(this.page).toHaveURL(/\/(creator\/dashboard|feed)/);
  }

  async expectLoginError() {
    await expect(this.loginError).toBeVisible();
  }
}
