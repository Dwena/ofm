import { test, expect } from './fixtures/auth.fixture';
import { pngFile, textFile, videoPath } from './fixtures/files';

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
    await uploadPage.selectTier('Basic');
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

    await expect(page.getByText(/Ajoutez un titre/)).toBeVisible();
    await expect(uploadPage.publishButton).toBeDisabled();
  });

  test('annuler revient à la page précédente', async ({ uploadPage, page }) => {
    await page.goto('/creator/dashboard');
    await uploadPage.goto();
    await uploadPage.cancelButton.click();

    await expect(page).toHaveURL(/\/creator\/dashboard/);
  });

  // No creator content-management screen (edit / delete) exists yet in the web app
  test.fixme('modifier un contenu publié', async () => {});
  test.fixme('supprimer un contenu publié', async () => {});
});
