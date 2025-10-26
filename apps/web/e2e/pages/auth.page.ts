import { Page, Locator, expect } from '@playwright/test';

export class AuthPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly registerButton: Locator;
  readonly usernameInput: Locator;
  readonly roleSelect: Locator;
  readonly passwordConfirmInput: Locator;
  readonly registerSubmitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]').first();
    this.loginButton = page.locator('button[type="submit"]:has-text("Se connecter")');
    this.registerButton = page.locator('a:has-text("Créer un compte")');
    this.usernameInput = page.locator('input[name="username"]');
    this.roleSelect = page.locator('select[name="role"]');
    this.passwordConfirmInput = page.locator('input[type="password"]').nth(1);
    this.registerSubmitButton = page.locator('button[type="submit"]:has-text("S\'inscrire")');
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
    await this.registerButton.click();
    await this.page.waitForURL(/\/register/);
  }

  async register(email: string, username: string, password: string, role: 'CREATOR' | 'SUBSCRIBER' = 'CREATOR') {
    await this.page.goto('/register');
    await this.emailInput.fill(email);
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.passwordConfirmInput.fill(password);

    if (this.roleSelect) {
      await this.roleSelect.selectOption(role);
    }

    await this.registerSubmitButton.click();
  }

  async expectToBeOnDashboard() {
    await expect(this.page).toHaveURL(/\/(creator\/dashboard|feed)/);
  }

  async expectLoginError() {
    await expect(this.page.locator('text=Identifiants incorrects')).toBeVisible();
  }

  async expectValidationError(message: string) {
    await expect(this.page.locator(`text=${message}`)).toBeVisible();
  }
}
