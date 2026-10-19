import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UsersService } from './users.service';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MessagingService } from '../messaging/messaging.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

describe('UsersService.updateProfile', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: { update: jest.fn(), findUnique: jest.fn() },
    creatorProfile: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: {} },
        { provide: MessagingService, useValue: { canMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    // Reads: role check, then findById for the response
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CREATOR' });
  });

  it('only updates the fields sent, trimming values and clearing empty ones', async () => {
    mockPrismaService.user.update.mockResolvedValue({ id: 'user-1' });

    await service.updateProfile('user-1', {
      displayName: '  Alice  ',
      bio: '',
      coverImage: null,
      avatar: 'https://cdn.example.com/a.png',
    });

    expect(mockPrismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { displayName: 'Alice', bio: null, coverImage: null, avatar: 'https://cdn.example.com/a.png' },
    });
    expect(mockPrismaService.creatorProfile.upsert).not.toHaveBeenCalled();
  });

  it('updates creator settings through the creator profile', async () => {
    await service.updateProfile('user-1', { allowMessages: false, minimumTip: 5 });

    expect(mockPrismaService.creatorProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', allowMessages: false, minimumTip: 5 },
      update: { allowMessages: false, minimumTip: 5 },
    });
    expect(mockPrismaService.user.update).not.toHaveBeenCalled();
  });

  it('refuses creator settings for a non-creator', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'SUBSCRIBER' });

    await expect(service.updateProfile('user-1', { allowTips: false })).rejects.toThrow(BadRequestException);
    expect(mockPrismaService.creatorProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrismaService.user.update).not.toHaveBeenCalled();
  });

  describe('UpdateProfileDto validation', () => {
    const errorsFor = async (payload: Record<string, unknown>) =>
      (await validate(plainToInstance(UpdateProfileDto, payload))).map((e) => e.property);

    it('accepts avatar / cover URLs and an empty website (clear)', async () => {
      expect(await errorsFor({ avatar: 'https://x.test/a.png', coverImage: null, website: '' })).toEqual([]);
    });

    it('rejects an invalid website and a too long bio', async () => {
      expect(await errorsFor({ website: 'not a url', bio: 'x'.repeat(501) })).toEqual(
        expect.arrayContaining(['website', 'bio']),
      );
    });
  });
});
