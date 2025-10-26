import { Page, Locator, expect } from '@playwright/test';

export class UploadPage {
  readonly page: Page;
  readonly fileInput: Locator;
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly tierSelect: Locator;
  readonly publishButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.fileInput = page.locator('input[type="file"]');
    this.titleInput = page.locator('input[placeholder*="Titre"]');
    this.descriptionInput = page.locator('textarea[placeholder*="Décrivez"]');
    this.tierSelect = page.locator('select, [role="combobox"]').first();
    this.publishButton = page.locator('button:has-text("Publier")');
    this.cancelButton = page.locator('button:has-text("Annuler")');
  }

  async goto() {
    await this.page.goto('/creator/upload');
  }

  async uploadFile(filePath: string) {
    await this.fileInput.setInputFiles(filePath);
  }

  async fillContentDetails(title: string, description: string, tier: string = 'FREE') {
    await this.titleInput.fill(title);
    await this.descriptionInput.fill(description);
    // Handle tier selection - this might need adjustment based on actual UI
    if (await this.tierSelect.count() > 0) {
      await this.tierSelect.click();
      await this.page.click(`text=${tier}`);
    }
  }

  async publish() {
    await this.publishButton.click();
  }

  async expectUploadSuccess() {
    await expect(this.page).toHaveURL(/\/creator\/dashboard/, { timeout: 10000 });
  }

  async expectFileUploaded(fileName: string) {
    await expect(this.page.locator(`text=${fileName}`)).toBeVisible();
  }

  async expectValidationError() {
    await expect(this.publishButton).toBeDisabled();
  }
}
