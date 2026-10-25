import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from './settings.service';
import { MaintenanceGuard } from './maintenance.guard';
import { PrismaService } from '../common/database/prisma.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let env: Record<string, string | undefined>;

  const mockPrismaService = {
    platformSetting: {
      findMany: jest.fn(),
      upsert: jest.fn((args) => args),
      deleteMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (ops) => ops),
  };

  beforeEach(async () => {
    env = {};
    jest.clearAllMocks();
    mockPrismaService.platformSetting.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => env[key]) } },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('falls back to defaults when nothing is configured', async () => {
    expect(await service.getAll()).toEqual(
      expect.objectContaining({
        platformFeePercentage: 15,
        minimumPayoutAmount: 50,
        registrationOpen: true,
        maintenanceMode: false,
      }),
    );
  });

  it('falls back to environment variables', async () => {
    env.PLATFORM_FEE_PERCENTAGE = '20';
    env.REGISTRATION_OPEN = 'false';

    expect(await service.getPlatformFeePercentage()).toBe(20);
    expect(await service.isRegistrationOpen()).toBe(false);
    const view = await service.getAdminView();
    expect(view.meta.platformFeePercentage.source).toBe('environment');
    expect(view.meta.minimumPayoutAmount.source).toBe('default');
  });

  it('prefers database values and caches them', async () => {
    env.PLATFORM_FEE_PERCENTAGE = '20';
    mockPrismaService.platformSetting.findMany.mockResolvedValue([
      { key: 'platformFeePercentage', value: 12.5, updatedAt: new Date(), updatedBy: 'admin-1' },
    ]);

    expect(await service.getPlatformFeePercentage()).toBe(12.5);
    expect(await service.getPlatformFeePercentage()).toBe(12.5);
    expect(mockPrismaService.platformSetting.findMany).toHaveBeenCalledTimes(1);
  });

  it('uses env values when the settings table cannot be read', async () => {
    env.MINIMUM_PAYOUT_AMOUNT = '75';
    mockPrismaService.platformSetting.findMany.mockRejectedValue(new Error('relation does not exist'));

    expect(await service.getMinimumPayoutAmount()).toBe(75);
  });

  it('updates only changed values, audits them and invalidates the cache', async () => {
    const changes = await service.update('admin-1', { platformFeePercentage: 10, registrationOpen: true });

    expect(changes).toEqual({ platformFeePercentage: { from: 15, to: 10 } });
    expect(mockPrismaService.platformSetting.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'platformFeePercentage' } }),
    );
    expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'admin-1', action: 'SETTINGS_UPDATED', resource: 'SETTINGS' }),
    });

    await service.getAll();
    expect(mockPrismaService.platformSetting.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects out of range values', async () => {
    await expect(service.update('admin-1', { platformFeePercentage: 80 })).rejects.toThrow(BadRequestException);
    expect(mockPrismaService.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it('resets a setting to its fallback', async () => {
    mockPrismaService.platformSetting.findMany.mockResolvedValue([
      { key: 'maintenanceMode', value: true, updatedAt: new Date(), updatedBy: 'admin-1' },
    ]);

    const change = await service.reset('admin-1', 'maintenanceMode');

    expect(change).toEqual({ from: true, to: false });
    expect(mockPrismaService.platformSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'maintenanceMode' } });
    expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SETTINGS_RESET' }),
    });
  });
});

describe('MaintenanceGuard', () => {
  const settings = { getMaintenance: jest.fn() };
  const jwt = { verify: jest.fn() };
  const guard = new MaintenanceGuard(
    settings as unknown as SettingsService,
    jwt as unknown as JwtService,
    { get: jest.fn(() => 'secret') } as unknown as ConfigService,
  );

  const context = (url: string, authorization?: string) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, headers: { authorization } }) }),
    }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('lets everything through when maintenance is off', async () => {
    settings.getMaintenance.mockResolvedValue({ enabled: false, message: '' });
    await expect(guard.canActivate(context('/api/v1/content'))).resolves.toBe(true);
  });

  it('blocks non-admin requests during maintenance', async () => {
    settings.getMaintenance.mockResolvedValue({ enabled: true, message: 'Maintenance' });
    jwt.verify.mockReturnValue({ sub: 'u1', role: 'SUBSCRIBER' });

    await expect(guard.canActivate(context('/api/v1/content', 'Bearer token'))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('keeps auth, admin and admins reachable during maintenance', async () => {
    settings.getMaintenance.mockResolvedValue({ enabled: true, message: 'Maintenance' });
    jwt.verify.mockReturnValue({ sub: 'a1', role: 'ADMIN' });

    await expect(guard.canActivate(context('/api/v1/auth/login'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/api/v1/admin/settings'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/api/v1/content', 'Bearer token'))).resolves.toBe(true);
  });
});
