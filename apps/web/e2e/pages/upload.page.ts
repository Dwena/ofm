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
  readonly visibilitySelect: Locator;
  readonly ppvPriceInput: Locator;
  readonly scheduledForInput: Locator;
  readonly publishButton: Locator;
  readonly saveDraftButton: Locator;
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
    this.visibilitySelect = page.getByTestId('content-visibility');
    this.ppvPriceInput = page.getByTestId('content-ppv-price');
    this.scheduledForInput = page.getByTestId('content-scheduled-for');
    this.publishButton = page.getByTestId('publish-content');
    this.saveDraftButton = page.getByTestId('save-draft');
    this.cancelButton = page.getByRole('button', { name: 'Annuler', exact: true });
  }

  async goto() {
    await this.page.goto('/creator/upload');
    await expect(this.heading).toBeVisible();
  }

  async uploadFiles(files: InputFile | InputFile[]) {
    await this.fileInput.setInputFiles(files as any);
  }

  /** Visibility labels: « Public », « Abonnés », « Abonnés Premium », « Pay-Per-View », « Privé » */
  async selectVisibility(label: string) {
    await this.visibilitySelect.click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async enablePpv(price: string) {
    await this.selectVisibility('Pay-Per-View');
    await this.ppvPriceInput.fill(price);
  }

  /** Schedule the publication `minutesFromNow` minutes ahead */
  async schedule(minutesFromNow = 60 * 24) {
    await this.page.getByTestId('publish-mode-schedule').check();
    const date = new Date(Date.now() + minutesFromNow * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await this.scheduledForInput.fill(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
    );
  }

  async saveDraft() {
    await expect(this.saveDraftButton).toBeEnabled({ timeout: 30000 });
    await this.saveDraftButton.click();
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
