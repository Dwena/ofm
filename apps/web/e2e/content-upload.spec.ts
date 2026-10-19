import { test, expect } from './fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { pngFile, textFile, videoPath } from './fixtures/files';
import { UploadPage } from './pages/upload.page';

test.describe('Publication de contenu', () => {
  test.beforeEach(async ({ asCreator, uploadPage }) => {
    await uploadPage.goto();
  });

  test('publie une image réservée aux abonnés', async ({ uploadPage, page }) => {
    await uploadPage.uploadFiles(pngFile('e2e-image.png'));

    await uploadPage.expectFileListed('e2e-image.png');
    await expect(page.getByRole('img', { name: 'Preview' })).toBeVisible({ timeout: 10000 });

    const title = `Contenu E2E ${Date.now()}`;
    await uploadPage.fillContentDetails(title, 'Publication créée par les tests E2E');
    await uploadPage.selectVisibility('Abonnés');
    await uploadPage.waitForUploads();
    await uploadPage.publish();

    await uploadPage.expectUploadSuccess();
    // The new content shows up in « Contenus Récents »
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
  });

  test('publie un contenu Pay-Per-View', async ({ uploadPage }) => {
    await uploadPage.uploadFiles(pngFile('e2e-ppv.png'));
    await uploadPage.fillContentDetails(`PPV E2E ${Date.now()}`);
    await uploadPage.enablePpv('9.99');
    await uploadPage.waitForUploads();
    await uploadPage.publish();

    await uploadPage.expectUploadSuccess();
  });

  test('suit le traitement d’une vidéo', async ({ uploadPage }) => {
    test.skip(!videoPath, 'Définissez E2E_VIDEO_PATH (fichier .mp4) pour tester le traitement vidéo');

    await uploadPage.uploadFiles(videoPath!);

    // MediaJobProgress: « Vidéo en file d'attente » → « Traitement de la vidéo » → « Vidéo prête »
    await expect(uploadPage.jobStatus.first()).toHaveText(/Vidéo en file d'attente|Traitement de la vidéo|Vidéo prête/, {
      timeout: 30000,
    });
    await expect(uploadPage.jobStatus.first()).toHaveAttribute('data-status', 'completed', { timeout: 120000 });
    await expect(uploadPage.jobStatus.first()).toHaveText(/Vidéo prête/);

    await uploadPage.fillContentDetails(`Vidéo E2E ${Date.now()}`, 'Vidéo publique');
    await uploadPage.publish();
    await uploadPage.expectUploadSuccess();
  });

  test('accepte plusieurs images (album)', async ({ uploadPage, page }) => {
    await expect(uploadPage.fileInput).toHaveAttribute('multiple', '');

    await uploadPage.uploadFiles([pngFile('album-1.png'), pngFile('album-2.png')]);
    await expect(uploadPage.fileItems).toHaveCount(2);
    await expect(page.getByText(/2.*fichiers/)).toBeVisible();

    await uploadPage.fillContentDetails(`Album E2E ${Date.now()}`);
    await uploadPage.waitForUploads();
    await uploadPage.publish();
    await uploadPage.expectUploadSuccess();
  });

  test('refuse un type de fichier non supporté', async ({ uploadPage }) => {
    await uploadPage.uploadFiles(textFile());

    await expect(uploadPage.fileErrors.first()).toHaveText(/Type de fichier non supporté/);
    await expect(uploadPage.publishButton).toBeDisabled();
  });

  test('retire un fichier de la liste', async ({ uploadPage, page }) => {
    await uploadPage.uploadFiles(textFile('a-retirer.txt'));
    await uploadPage.expectFileListed('a-retirer.txt');

    await page.getByRole('button', { name: 'Retirer le fichier' }).click();
    await expect(uploadPage.fileItems).toHaveCount(0);
  });

  test('exige un titre avant publication', async ({ uploadPage, page }) => {
    await uploadPage.uploadFiles(pngFile());

    await expect(page.getByTestId('publish-blockers')).toContainText('Ajoutez un titre');
    await expect(uploadPage.publishButton).toBeDisabled();
  });

  test('annuler revient à la page précédente', async ({ uploadPage, page }) => {
    await page.goto('/creator/dashboard');
    await uploadPage.goto();
    await uploadPage.cancelButton.click();

    await expect(page).toHaveURL(/\/creator\/dashboard/);
  });

  test('demande confirmation avant d’abandonner un contenu commencé', async ({ uploadPage, page }) => {
    await page.goto('/creator/dashboard');
    await uploadPage.goto();
    await uploadPage.fillContentDetails('Brouillon abandonné');
    await uploadPage.cancelButton.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Abandonner ce contenu ?');
    await dialog.getByRole('button', { name: 'Continuer l’édition' }).click();
    await expect(uploadPage.heading).toBeVisible();

    await uploadPage.cancelButton.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abandonner' }).click();
    await expect(page).toHaveURL(/\/creator\/dashboard/);
  });

  test('exige un prix valide pour un contenu PPV', async ({ uploadPage, page }) => {
    await uploadPage.fillContentDetails(`PPV sans prix ${Date.now()}`, 'Texte');
    await uploadPage.enablePpv('0.10');
    await uploadPage.ppvPriceInput.blur();

    await expect(page.getByText('Prix minimum : 0,50 €')).toBeVisible();
    await expect(uploadPage.publishButton).toBeDisabled();
  });

  test('enregistre un brouillon', async ({ uploadPage, page }) => {
    const title = `Brouillon E2E ${Date.now()}`;
    await uploadPage.fillContentDetails(title, 'Brouillon créé par les tests E2E');
    await uploadPage.saveDraft();

    await expect(page).toHaveURL(/\/creator\/content\?status=draft/, { timeout: 15000 });
    await expect(page.getByTestId('creator-content-item').filter({ hasText: title })).toBeVisible();
  });

  test('programme une publication', async ({ uploadPage, page }) => {
    const title = `Programmé E2E ${Date.now()}`;
    await uploadPage.fillContentDetails(title, 'Publication programmée par les tests E2E');
    await uploadPage.schedule();
    await uploadPage.publish();

    await expect(page).toHaveURL(/\/creator\/content\?status=scheduled/, { timeout: 15000 });
    await expect(page.getByTestId('creator-content-item').filter({ hasText: title })).toContainText('Programmé');
  });
});

test.describe('Gestion des contenus', () => {
  test.beforeEach(async ({ asCreator }) => {});

  /** Publish a public text post from the upload page, then find it in « Mes contenus » */
  async function publishAndFind(uploadPage: UploadPage, page: Page, title: string) {
    await uploadPage.goto();
    await uploadPage.fillContentDetails(title, 'Contenu créé par les tests E2E');
    await uploadPage.selectVisibility('Public');
    await uploadPage.publish();
    await uploadPage.expectUploadSuccess();

    await page.goto('/creator/content');
    await page.getByRole('textbox', { name: 'Rechercher un contenu' }).fill(title);
    const item = page.getByTestId('creator-content-item').filter({ hasText: title });
    await expect(item).toBeVisible({ timeout: 10000 });
    return item;
  }

  test('affiche les contenus avec filtres et statistiques', async ({ page }) => {
    await page.goto('/creator/content');

    await expect(page.getByRole('heading', { level: 1, name: 'Mes contenus' })).toBeVisible();
    for (const label of ['Tous', 'Publiés', 'Brouillons', 'Programmés', 'Archivés']) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(page.getByTestId('creator-content-stats').first()).toBeVisible();

    await page.getByTestId('content-filter-draft').click();
    await expect(page).toHaveURL(/status=draft/);
    await expect(page.getByTestId('creator-content-item').first()).toContainText('Brouillon');
  });

  test('modifier un contenu publié', async ({ uploadPage, page }) => {
    const title = `À modifier E2E ${Date.now()}`;
    const item = await publishAndFind(uploadPage, page, title);

    await item.getByTestId('content-edit').click();
    const form = page.getByTestId('edit-content-form');
    await expect(form).toBeVisible();

    const newTitle = `${title} (modifié)`;
    await form.getByTestId('edit-content-title').fill(newTitle);
    await form.getByTestId('edit-content-description').fill('Description mise à jour');
    await form.getByTestId('edit-content-visibility').click();
    await page.getByRole('option', { name: /^Pay-Per-View/ }).click();
    await form.getByTestId('edit-content-price').fill('3.50');
    await form.getByTestId('edit-content-submit').click();

    await expect(form).toBeHidden();
    await page.getByRole('textbox', { name: 'Rechercher un contenu' }).fill(newTitle);
    const updated = page.getByTestId('creator-content-item').filter({ hasText: newTitle });
    await expect(updated).toBeVisible();
    await expect(updated).toContainText('Description mise à jour');
    await expect(updated).toContainText('PPV');
  });

  test('archiver puis désarchiver un contenu', async ({ uploadPage, page }) => {
    const title = `À archiver E2E ${Date.now()}`;
    const item = await publishAndFind(uploadPage, page, title);

    await item.getByTestId('content-archive').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archiver' }).click();
    await expect(item).toContainText('Archivé');

    await item.getByTestId('content-unarchive').click();
    await expect(item).toContainText('Publié');
  });

  test('supprimer un contenu publié', async ({ uploadPage, page }) => {
    const title = `À supprimer E2E ${Date.now()}`;
    const item = await publishAndFind(uploadPage, page, title);

    // Cancelling keeps the content
    await item.getByTestId('content-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(item).toBeVisible();

    await item.getByTestId('content-delete').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Supprimer ce contenu ?');
    await dialog.getByRole('button', { name: 'Supprimer' }).click();

    await expect(item).toHaveCount(0);
    await expect(page.getByText(`Aucun contenu ne correspond à « ${title} »`)).toBeVisible();
  });

  test('publier un brouillon', async ({ uploadPage, page }) => {
    const title = `Brouillon à publier E2E ${Date.now()}`;
    await uploadPage.goto();
    await uploadPage.fillContentDetails(title);
    await uploadPage.saveDraft();
    await expect(page).toHaveURL(/\/creator\/content\?status=draft/, { timeout: 15000 });

    const item = page.getByTestId('creator-content-item').filter({ hasText: title });
    await item.getByTestId('content-publish').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publier' }).click();

    // Leaves the « Brouillons » filter once published
    await expect(item).toHaveCount(0);
    await page.getByTestId('content-filter-published').click();
    await expect(page.getByTestId('creator-content-item').filter({ hasText: title })).toContainText('Publié');
  });
});
