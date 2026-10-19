/**
 * In-memory files for upload tests (no binary fixtures committed).
 * Pass them to `locator.setInputFiles(...)`.
 */

// 1x1 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export function pngFile(name = 'test-image.png') {
  return { name, mimeType: 'image/png', buffer: PNG_1PX };
}

export function textFile(name = 'test-file.txt') {
  return { name, mimeType: 'text/plain', buffer: Buffer.from('not a media file') };
}

/**
 * A real video is needed for server-side processing: set E2E_VIDEO_PATH to an .mp4 file.
 */
export const videoPath = process.env.E2E_VIDEO_PATH;
