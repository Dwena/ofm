import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('UsersService', () => {
  let service: UsersService;

  const userId = '11111111-2222-3333-4444-555555555555';

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    creatorProfile: {
      upsert: jest.fn(),
    },
  };

  const mockStorageService = {
    uploadFile: jest.fn(),
    getFile: jest.fn(),
    deleteFile: jest.fn(),
  };

  const image = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      buffer: Buffer.from('img'),
      size: 1024,
      mimetype: 'image/png',
      originalname: 'photo.png',
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.resetAllMocks();
  });

  describe('updateProfile', () => {
    it('updates user fields and creator settings separately', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ role: 'CREATOR' })
        .mockResolvedValueOnce({ id: userId, displayName: 'Alice', creatorProfile: { allowTips: false } });

      const result = await service.updateProfile(userId, {
        displayName: 'Alice',
        website: null,
        welcomeMessage: 'Bienvenue',
        allowMessages: true,
        allowTips: false,
        minimumTip: 3,
      });

      expect(mockPrismaService.creatorProfile.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId, welcomeMessage: 'Bienvenue', allowMessages: true, allowTips: false, minimumTip: 3 },
        update: { welcomeMessage: 'Bienvenue', allowMessages: true, allowTips: false, minimumTip: 3 },
      });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { displayName: 'Alice', website: null },
      });
      expect(result).toEqual(expect.objectContaining({ id: userId }));
    });

    it('rejects creator settings for a non-creator', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER' });

      await expect(service.updateProfile(userId, { allowTips: true })).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.creatorProfile.upsert).not.toHaveBeenCalled();
    });

    it('does not touch the creator profile for plain profile fields', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });

      await service.updateProfile(userId, { bio: 'Hello' });

      expect(mockPrismaService.creatorProfile.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({ where: { id: userId }, data: { bio: 'Hello' } });
    });
  });

  describe('uploadProfileImage', () => {
    it('stores the image and sets a public proxied URL', async () => {
      mockStorageService.uploadFile.mockResolvedValue({ key: `profiles/${userId}/abcdefgh12345678.png` });
      mockStorageService.deleteFile.mockResolvedValue(undefined);
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({
          avatar: `http://api/api/v1/users/profile-images/profiles/${userId}/oldoldold1234567.png`,
          coverImage: null,
        })
        .mockResolvedValueOnce({ id: userId });

      await service.uploadProfileImage(userId, 'avatar', image(), 'http://localhost:3001/api/v1/');

      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        'avatar.png',
        'image/png',
        `profiles/${userId}`,
      );
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          avatar: `http://localhost:3001/api/v1/users/profile-images/profiles/${userId}/abcdefgh12345678.png`,
        },
      });
      expect(mockStorageService.deleteFile).toHaveBeenCalledWith(`profiles/${userId}/oldoldold1234567.png`);
    });

    it('sets the cover image and leaves an external previous URL alone', async () => {
      mockStorageService.uploadFile.mockResolvedValue({ key: `profiles/${userId}/abcdefgh12345678.jpg` });
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce({ avatar: null, coverImage: 'https://picsum.photos/cover.jpg' })
        .mockResolvedValueOnce({ id: userId });

      await service.uploadProfileImage(userId, 'cover', image({ mimetype: 'image/jpeg' }), 'http://api/api/v1');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { coverImage: expect.stringContaining('/users/profile-images/profiles/') },
      });
      expect(mockStorageService.deleteFile).not.toHaveBeenCalled();
    });

    it('reports an unavailable storage clearly', async () => {
      mockStorageService.uploadFile.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.uploadProfileImage(userId, 'avatar', image(), 'x')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('rejects missing, unsupported and oversized files', async () => {
      await expect(service.uploadProfileImage(userId, 'avatar', undefined, 'x')).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadProfileImage(userId, 'avatar', image({ mimetype: 'image/svg+xml' }), 'x'),
      ).rejects.toThrow(/Format non supporté/);
      await expect(
        service.uploadProfileImage(userId, 'avatar', image({ size: 6 * 1024 * 1024 }), 'x'),
      ).rejects.toThrow(/5 Mo/);
      expect(mockStorageService.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('getProfileImage', () => {
    it('serves a profile image with its content type', async () => {
      mockStorageService.getFile.mockResolvedValue(Buffer.from('img'));

      const result = await service.getProfileImage(`profiles/${userId}/abcdefgh12345678.webp`);

      expect(result.contentType).toBe('image/webp');
    });

    it('refuses keys outside the profile images folder', async () => {
      await expect(service.getProfileImage('users/secret/content.mp4')).rejects.toThrow(NotFoundException);
      await expect(service.getProfileImage(`profiles/${userId}/../x.png`)).rejects.toThrow(NotFoundException);
      expect(mockStorageService.getFile).not.toHaveBeenCalled();
    });

    it('returns 404 when the file is missing', async () => {
      mockStorageService.getFile.mockRejectedValue(new Error('NoSuchKey'));

      await expect(service.getProfileImage(`profiles/${userId}/abcdefgh12345678.png`)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
