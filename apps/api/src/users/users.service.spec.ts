import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UsersService } from './users.service';
import { PrismaService } from '../common/database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

describe('UsersService.updateProfile', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: { update: jest.fn() },
    creatorProfile: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('only updates the fields sent, trimming values and clearing empty ones', async () => {
    mockPrismaService.user.update.mockResolvedValue({ id: 'user-1' });

    await service.updateProfile('user-1', {
      displayName: '  Alice  ',
      bio: '',
      coverImage: null,
      avatar: 'https://cdn.example.com/a.png',
    });

    expect(mockPrismaService.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { displayName: 'Alice', bio: null, coverImage: null, avatar: 'https://cdn.example.com/a.png' },
      }),
    );
  });

  it('updates creator settings through the creator profile', async () => {
    mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ id: 'cp-1' });
    mockPrismaService.user.update.mockResolvedValue({
      id: 'user-1',
      creatorProfile: { allowMessages: false, allowTips: true, minimumTip: '5.00' },
    });

    const result = await service.updateProfile('user-1', { allowMessages: false, minimumTip: 5 });

    expect(mockPrismaService.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { creatorProfile: { update: { allowMessages: false, minimumTip: 5 } } },
      }),
    );
    expect(result.creatorProfile).toEqual({ allowMessages: false, allowTips: true, minimumTip: 5 });
  });

  it('refuses creator settings for a non-creator', async () => {
    mockPrismaService.creatorProfile.findUnique.mockResolvedValue(null);

    await expect(service.updateProfile('user-1', { allowTips: false })).rejects.toThrow(BadRequestException);
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
