import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaValidator } from './validators/media.validator';

describe('MediaService', () => {
  let service: MediaService;

  const mockPrismaService = {
    contentFile: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockStorageService = {
    uploadFile: jest.fn(),
    generateUserPath: jest.fn(),
  };

  const mockValidator = {
    validateImage: jest.fn(),
    validateVideo: jest.fn(),
  };

  const mockImageQueue = { add: jest.fn(), getJob: jest.fn() };
  const mockVideoQueue = { add: jest.fn(), getJob: jest.fn() };

  const makeJob = (overrides: Record<string, any> = {}) => ({
    id: 42,
    data: { userId: 'user-1' },
    attemptsMade: 0,
    failedReason: undefined,
    returnvalue: null,
    timestamp: Date.UTC(2026, 0, 1),
    finishedOn: undefined,
    progress: jest.fn().mockReturnValue(37),
    getState: jest.fn().mockResolvedValue('active'),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: MediaValidator, useValue: mockValidator },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: getQueueToken('image-processing'), useValue: mockImageQueue },
        { provide: getQueueToken('video-processing'), useValue: mockVideoQueue },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    const file = {
      mimetype: 'video/mp4',
      originalname: 'clip.mp4',
      size: 1024,
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    it('returns a pollable jobId for queued videos', async () => {
      mockStorageService.generateUserPath.mockReturnValue('users/user-1/videos');
      mockStorageService.uploadFile.mockResolvedValue({ key: 'k.mp4', url: 'http://u' });
      mockPrismaService.contentFile.create.mockResolvedValue({
        id: 'file-1',
        filename: 'clip.mp4',
        size: BigInt(1024),
      });
      mockVideoQueue.add.mockResolvedValue({ id: 7 });

      const result = await service.upload(file, 'user-1');

      expect(mockVideoQueue.add).toHaveBeenCalledWith(
        'process-video',
        expect.objectContaining({ contentFileId: 'file-1', userId: 'user-1' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ id: 'file-1', jobId: 'video-7', status: 'processing', size: 1024 }),
      );
    });

    it('returns no jobId for files that are not processed', async () => {
      mockStorageService.generateUserPath.mockReturnValue('users/user-1/images');
      mockStorageService.uploadFile.mockResolvedValue({ key: 'k.pdf', url: 'http://u' });
      mockPrismaService.contentFile.create.mockResolvedValue({
        id: 'file-2',
        filename: 'doc.pdf',
        size: BigInt(10),
      });

      const result = await service.upload(
        { ...file, mimetype: 'application/pdf', originalname: 'doc.pdf' } as Express.Multer.File,
        'user-1',
      );

      expect(mockImageQueue.add).not.toHaveBeenCalled();
      expect(mockVideoQueue.add).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ jobId: null, status: 'ready' }));
    });
  });

  describe('getJobStatus', () => {
    it('rejects malformed job ids', async () => {
      await expect(service.getJobStatus('bogus', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('returns progress of an active video job', async () => {
      mockVideoQueue.getJob.mockResolvedValue(makeJob());

      const result = await service.getJobStatus('video-42', 'user-1');

      expect(mockVideoQueue.getJob).toHaveBeenCalledWith('42');
      expect(result).toEqual(
        expect.objectContaining({
          jobId: 'video-42',
          type: 'VIDEO',
          status: 'processing',
          progress: 37,
          failedReason: null,
        }),
      );
    });

    it('reports 100% and the result when completed', async () => {
      mockImageQueue.getJob.mockResolvedValue(
        makeJob({
          getState: jest.fn().mockResolvedValue('completed'),
          progress: jest.fn().mockReturnValue(60),
          returnvalue: { success: true },
          finishedOn: Date.UTC(2026, 0, 2),
        }),
      );

      const result = await service.getJobStatus('image-42', 'user-1');

      expect(mockImageQueue.getJob).toHaveBeenCalledWith('42');
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.result).toEqual({ success: true });
      expect(result.finishedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('exposes the failure reason of failed jobs', async () => {
      mockVideoQueue.getJob.mockResolvedValue(
        makeJob({
          getState: jest.fn().mockResolvedValue('failed'),
          failedReason: 'ffmpeg exited with code 1',
        }),
      );

      const result = await service.getJobStatus('video-42', 'user-1');

      expect(result.status).toBe('failed');
      expect(result.failedReason).toBe('ffmpeg exited with code 1');
    });

    it('maps waiting jobs to queued', async () => {
      mockVideoQueue.getJob.mockResolvedValue(
        makeJob({ getState: jest.fn().mockResolvedValue('waiting'), progress: jest.fn().mockReturnValue(0) }),
      );

      const result = await service.getJobStatus('video-42', 'user-1');

      expect(result.status).toBe('queued');
      expect(result.progress).toBe(0);
    });

    it("hides other users' jobs", async () => {
      mockVideoQueue.getJob.mockResolvedValue(makeJob({ data: { userId: 'someone-else' } }));

      await expect(service.getJobStatus('video-42', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws when the job does not exist', async () => {
      mockVideoQueue.getJob.mockResolvedValue(null);

      await expect(service.getJobStatus('video-404', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
