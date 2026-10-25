import { MediaScanService, isMediaScanConfigured } from './media-scan.service';

describe('MediaScanService', () => {
  let prisma: any;
  let storage: any;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  const build = (env: Record<string, string>) =>
    new MediaScanService({ get: jest.fn((key: string, fallback?: any) => env[key] ?? fallback) } as any, prisma, storage);

  beforeEach(() => {
    prisma = {
      contentFile: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ contentId: 'content-1' }]),
      },
      content: { updateMany: jest.fn(), findUnique: jest.fn() },
      story: { updateMany: jest.fn() },
      user: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      auditLog: { create: jest.fn() },
      notification: { createMany: jest.fn() },
    };
    storage = { getFile: jest.fn().mockResolvedValue(Buffer.from('stored')), deleteFile: jest.fn() };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it('marks media SKIPPED when no provider is configured (default)', async () => {
    const service = build({});
    expect(service.isEnabled).toBe(false);

    const outcome = await service.scanAndRecord(Buffer.from('img'), {
      userId: 'u1',
      key: 'users/u1/images/a.jpg',
      mimeType: 'image/jpeg',
      contentFileId: 'f-1',
    });

    expect(outcome).toBe('SKIPPED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.contentFile.updateMany).toHaveBeenCalledWith({
      where: { id: 'f-1' },
      data: { scanStatus: 'SKIPPED', scannedAt: expect.any(Date) },
    });
  });

  it('falls back to none without an API URL', () => {
    expect(build({ MEDIA_SCAN_PROVIDER: 'http' }).isEnabled).toBe(false);
    expect(isMediaScanConfigured({ get: (k: string, d?: any) => ({ MEDIA_SCAN_PROVIDER: 'http' } as any)[k] ?? d })).toBe(false);
  });

  it('sends the hashes to the HTTP provider and records CLEAN', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: false }) });
    const service = build({ MEDIA_SCAN_PROVIDER: 'http', MEDIA_SCAN_API_URL: 'https://scan.test', MEDIA_SCAN_API_KEY: 'k' });

    const outcome = await service.scanAndRecord(Buffer.from('img'), {
      userId: 'u1',
      key: 'users/u1/images/a.jpg',
      mimeType: 'image/jpeg',
    });

    expect(outcome).toBe('CLEAN');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://scan.test');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.sha256).toHaveLength(64);
    expect(body.md5).toHaveLength(32);
    expect(body.data).toBeUndefined();
    expect(prisma.contentFile.updateMany).toHaveBeenCalledWith({
      where: { storagePath: 'users/u1/images/a.jpg' },
      data: { scanStatus: 'CLEAN', scannedAt: expect.any(Date) },
    });
  });

  it('keeps PENDING when the provider fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const service = build({ MEDIA_SCAN_PROVIDER: 'http', MEDIA_SCAN_API_URL: 'https://scan.test' });
    const outcome = await service.scanAndRecord(Buffer.from('img'), { userId: 'u1', key: 'k', mimeType: 'video/mp4' });
    expect(outcome).toBe('PENDING');
    expect(prisma.contentFile.updateMany).not.toHaveBeenCalled();
  });

  it('on a match: blocks the media, suspends the uploader, alerts admins, never deletes the file', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: true, reference: 'case-42' }) });
    const service = build({ MEDIA_SCAN_PROVIDER: 'photodna', MEDIA_SCAN_API_URL: 'https://scan.test' });

    const outcome = await service.scanAndRecord(Buffer.from('img'), {
      userId: 'u1',
      key: 'users/u1/images/a.jpg',
      mimeType: 'image/png',
      contentFileId: 'f-1',
    });

    expect(outcome).toBe('FLAGGED');
    expect(prisma.content.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['content-1'] } }, data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', role: { not: 'ADMIN' } },
      data: expect.objectContaining({ status: 'SUSPENDED', suspendedUntil: null }),
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ILLEGAL_MEDIA_MATCH',
      metadata: expect.objectContaining({ creatorId: 'u1', providerReference: 'case-42' }),
    });
    expect(prisma.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({
      userId: 'admin-1',
      message: expect.stringContaining('PHAROS'),
    });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('skips non image / video files', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: false }) });
    const service = build({ MEDIA_SCAN_PROVIDER: 'http', MEDIA_SCAN_API_URL: 'https://scan.test' });
    expect(await service.scanAndRecord(Buffer.from('%PDF'), { userId: 'u1', key: 'k', mimeType: 'application/pdf' })).toBe(
      'SKIPPED',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rescans the pending media of a content', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: false }) });
    const service = build({ MEDIA_SCAN_PROVIDER: 'http', MEDIA_SCAN_API_URL: 'https://scan.test' });
    prisma.content.findUnique.mockResolvedValue({
      id: 'content-1',
      creatorId: 'u1',
      files: [
        { id: 'f-1', storagePath: 'users/u1/a.jpg', mimeType: 'image/jpeg', scanStatus: 'PENDING' },
        { id: 'f-2', storagePath: 'users/u1/b.jpg', mimeType: 'image/jpeg', scanStatus: 'CLEAN' },
      ],
    });

    const result = await service.rescanContent('content-1');

    expect(storage.getFile).toHaveBeenCalledTimes(1);
    expect(result?.files).toEqual([
      { id: 'f-1', scanStatus: 'CLEAN' },
      { id: 'f-2', scanStatus: 'CLEAN' },
    ]);
  });
});
