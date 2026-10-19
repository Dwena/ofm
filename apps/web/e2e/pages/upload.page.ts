import { Page, Locator, expect } from '@playwright/test';

type InputFile = string | { name: string; mimeType: string; buffer: Buffer };

/**
 * Creator upload page (/creator/upload): files are uploaded as soon as they are
 * selected, then processed server-side (status shown by MediaJobProgress).
 */
export class UploadPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly fileInput: Locator;
  readonly fileItems: Locator;
  readonly fileErrors: Locator;
  readonly jobStatus: Locator;
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly tierSelect: Locator;
  readonly kindSelect: Locator;
  readonly ppvPriceInput: Locator;
  readonly publishButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1, name: 'Nouveau Contenu' });
    this.fileInput = page.getByTestId('upload-file-input');
    this.fileItems = page.getByTestId('upload-file-item');
    this.fileErrors = page.getByTestId('upload-file-error');
    this.jobStatus = page.getByTestId('media-job-status');
    this.titleInput = page.getByTestId('content-title');
    this.descriptionInput = page.getByTestId('content-description');
    this.tierSelect = page.getByTestId('content-tier');
    this.kindSelect = page.getByTestId('content-kind');
    this.ppvPriceInput = page.getByTestId('content-ppv-price');
    this.publishButton = page.getByTestId('publish-content');
    this.cancelButton = page.getByRole('button', { name: 'Annuler', exact: true });
  }

  async goto() {
    await this.page.goto('/creator/upload');
    await expect(this.heading).toBeVisible();
  }

  async uploadFiles(files: InputFile | InputFile[]) {
    await this.fileInput.setInputFiles(files as any);
  }

  /** Tier labels: « Gratuit (Public) », « Basic », « Premium », « VIP » */
  async selectTier(label: string) {
    await this.tierSelect.click();
    await this.page.getByRole('option', { name: label }).click();
  }

  async enablePpv(price: string) {
    await this.kindSelect.click();
    await this.page.getByRole('option', { name: 'Pay-Per-View' }).click();
    await this.ppvPriceInput.fill(price);
  }

  async fillContentDetails(title: string, description = '') {
    await this.titleInput.fill(title);
    if (description) await this.descriptionInput.fill(description);
  }

  /** Wait until every selected file is uploaded (publish button enabled once title is set) */
  async waitForUploads(timeout = 30000) {
    await expect(this.page.getByText(/en cours$/)).toHaveCount(0, { timeout });
  }

  async publish() {
    await expect(this.publishButton).toBeEnabled({ timeout: 30000 });
    await this.publishButton.click();
  }

  /** On success the creator is sent back to the dashboard */
  async expectUploadSuccess() {
    await expect(this.page).toHaveURL(/\/creator\/dashboard/, { timeout: 15000 });
  }

  async expectFileListed(fileName: string) {
    await expect(this.fileItems.filter({ hasText: fileName })).toBeVisible();
  }
}
