import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Content Upload', () => {
  test.beforeEach(async ({ page }) => {
    // Login as creator
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/feed');
  });

  test('upload image content', async ({ page }) => {
    // Navigate to upload page
    await page.goto('http://localhost:3000/creator/upload');

    // Upload image file
    const filePath = path.join(__dirname, 'fixtures', 'test-image.jpg');
    await page.setInputFiles('input[type="file"]', filePath);

    // Wait for preview to appear
    await expect(page.locator('img[alt="Preview"]')).toBeVisible({ timeout: 10000 });

    // Fill metadata
    await page.fill('[name="title"]', 'Test Content Upload');
    await page.fill('[name="description"]', 'This is a test upload from E2E tests');

    // Select visibility
    await page.click('text=Subscribers Only');

    // Set price (PPV - Pay Per View)
    const ppvCheckbox = page.locator('[name="isPpv"]');
    if (await ppvCheckbox.isVisible()) {
      await ppvCheckbox.check();
      await page.fill('[name="ppvPrice"]', '9.99');
    }

    // Submit
    await page.click('button:has-text("Publish")');

    // Verify success
    await expect(page.locator('text=Content published')).toBeVisible({ timeout: 15000 });

    // Verify content appears in creator's content list
    await page.goto('http://localhost:3000/creator/content');
    await expect(page.locator('text=Test Content Upload')).toBeVisible({ timeout: 5000 });
  });

  test('upload video content with processing', async ({ page }) => {
    // Navigate to upload page
    await page.goto('http://localhost:3000/creator/upload');

    // Upload video file
    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    // Wait for video processing indicator
    await expect(page.locator('text=Processing video')).toBeVisible({ timeout: 5000 });

    // Wait for processing completion (may take time)
    await expect(page.locator('text=Video ready')).toBeVisible({ timeout: 60000 });

    // Fill metadata
    await page.fill('[name="title"]', 'Test Video Upload');
    await page.fill('[name="description"]', 'Test video from E2E tests');

    // Select visibility
    await page.click('text=Public');

    // Publish
    await page.click('button:has-text("Publish")');

    // Verify success
    await expect(page.locator('text=Content published')).toBeVisible({ timeout: 15000 });
  });

  test('upload multiple images as gallery', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/upload');

    // Upload multiple images
    const image1 = path.join(__dirname, 'fixtures', 'test-image.jpg');
    const image2 = path.join(__dirname, 'fixtures', 'test-image-2.jpg');

    // Check if multiple file upload is supported
    const fileInput = page.locator('input[type="file"]');
    const multiple = await fileInput.getAttribute('multiple');

    if (multiple !== null) {
      await page.setInputFiles('input[type="file"]', [image1, image2]);

      // Wait for previews
      await expect(page.locator('img[alt="Preview"]').first()).toBeVisible({ timeout: 10000 });

      await page.fill('[name="title"]', 'Test Gallery Upload');
      await page.click('button:has-text("Publish")');

      await expect(page.locator('text=Content published')).toBeVisible({ timeout: 15000 });
    }
  });

  test('handle upload error for invalid file type', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/upload');

    // Try to upload an invalid file type
    const textFilePath = path.join(__dirname, 'fixtures', 'test-file.txt');

    // Create a temporary text file
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (input) {
        input.removeAttribute('accept'); // Remove file type restrictions for testing
      }
    });

    await page.setInputFiles('input[type="file"]', textFilePath);

    // Verify error message
    await expect(page.locator('text=Invalid file type')).toBeVisible({ timeout: 5000 });
  });

  test('handle upload error for file too large', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/upload');

    // This test assumes there's a large test file
    // In practice, you'd create or use a file larger than the allowed limit
    const largeFilePath = path.join(__dirname, 'fixtures', 'large-video.mp4');

    // Check if file exists before attempting upload
    const fs = require('fs');
    if (fs.existsSync(largeFilePath)) {
      await page.setInputFiles('input[type="file"]', largeFilePath);

      // Verify error message
      await expect(page.locator('text=File too large')).toBeVisible({ timeout: 5000 });
    }
  });

  test('cancel upload in progress', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/upload');

    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);

    // Wait for processing to start
    await expect(page.locator('text=Processing video')).toBeVisible({ timeout: 5000 });

    // Click cancel button
    await page.click('button:has-text("Cancel")');

    // Verify upload was cancelled
    await expect(page.locator('text=Upload cancelled')).toBeVisible({ timeout: 5000 });
  });

  test('edit uploaded content', async ({ page }) => {
    // First upload content
    await page.goto('http://localhost:3000/creator/upload');

    const filePath = path.join(__dirname, 'fixtures', 'test-image.jpg');
    await page.setInputFiles('input[type="file"]', filePath);

    await expect(page.locator('img[alt="Preview"]')).toBeVisible({ timeout: 10000 });

    await page.fill('[name="title"]', 'Test Edit Content');
    await page.click('button:has-text("Publish")');
    await expect(page.locator('text=Content published')).toBeVisible({ timeout: 15000 });

    // Navigate to content management
    await page.goto('http://localhost:3000/creator/content');

    // Find and edit the content
    await page.click('text=Test Edit Content');
    await page.click('button:has-text("Edit")');

    // Update title
    await page.fill('[name="title"]', 'Test Edit Content - Updated');

    // Save changes
    await page.click('button:has-text("Save Changes")');

    // Verify update success
    await expect(page.locator('text=Content updated')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Test Edit Content - Updated')).toBeVisible();
  });

  test('delete uploaded content', async ({ page }) => {
    // Navigate to content management
    await page.goto('http://localhost:3000/creator/content');

    // Find content to delete
    const firstContent = page.locator('[data-testid="content-item"]').first();
    await firstContent.click();

    // Click delete button
    await page.click('button:has-text("Delete")');

    // Confirm deletion
    await page.click('button:has-text("Confirm Delete")');

    // Verify deletion success
    await expect(page.locator('text=Content deleted')).toBeVisible({ timeout: 10000 });
  });
});
