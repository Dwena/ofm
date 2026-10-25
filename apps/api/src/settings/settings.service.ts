import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/database/prisma.service';

/**
 * Platform settings editable from the back-office.
 * Each setting is stored as a row of PlatformSetting (key/value); when no row
 * exists the value falls back to the matching environment variable, then to a default.
 */
export interface PlatformSettings {
  /** Commission taken by the platform on subscriptions, tips and PPV (percent) */
  platformFeePercentage: number;
  /** Minimum available balance (EUR) before an automated payout is created */
  minimumPayoutAmount: number;
  /** Days a creator earning stays on hold before it can be paid out (absorbs refunds and chargebacks) */
  earningsHoldDays: number;
  /** When false, POST /auth/register is refused */
  registrationOpen: boolean;
  /** When true, non-admin API requests are answered with 503 (see MaintenanceGuard) */
  maintenanceMode: boolean;
  /** Message returned to users while maintenance mode is enabled */
  maintenanceMessage: string;
}

export type PlatformSettingKey = keyof PlatformSettings;

interface SettingDefinition<K extends PlatformSettingKey = PlatformSettingKey> {
  env: string;
  type: 'number' | 'boolean' | 'string';
  default: PlatformSettings[K];
  min?: number;
  max?: number;
  maxLength?: number;
}

export const SETTING_DEFINITIONS: { [K in PlatformSettingKey]: SettingDefinition<K> } = {
  platformFeePercentage: { env: 'PLATFORM_FEE_PERCENTAGE', type: 'number', default: 15, min: 0, max: 50 },
  minimumPayoutAmount: { env: 'MINIMUM_PAYOUT_AMOUNT', type: 'number', default: 50, min: 0, max: 10000 },
  earningsHoldDays: { env: 'EARNINGS_HOLD_DAYS', type: 'number', default: 7, min: 0, max: 90 },
  registrationOpen: { env: 'REGISTRATION_OPEN', type: 'boolean', default: true },
  maintenanceMode: { env: 'MAINTENANCE_MODE', type: 'boolean', default: false },
  maintenanceMessage: {
    env: 'MAINTENANCE_MESSAGE',
    type: 'string',
    default: 'La plateforme est en maintenance. Merci de réessayer dans quelques instants.',
    maxLength: 500,
  },
};

const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as PlatformSettingKey[];

export interface SettingMeta {
  source: 'database' | 'environment' | 'default';
  fallbackValue: PlatformSettings[PlatformSettingKey];
  updatedAt: Date | null;
  updatedBy: string | null;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: { rows: Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null }>; expiresAt: number } | null =
    null;
  private loading: Promise<Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null }>> | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // ==================== Typed getters ====================

  async getPlatformFeePercentage(): Promise<number> {
    return this.get('platformFeePercentage');
  }

  /** Minimum payout, in euros */
  async getMinimumPayoutAmount(): Promise<number> {
    return this.get('minimumPayoutAmount');
  }

  async getEarningsHoldDays(): Promise<number> {
    return this.get('earningsHoldDays');
  }

  async isRegistrationOpen(): Promise<boolean> {
    return this.get('registrationOpen');
  }

  async getMaintenance(): Promise<{ enabled: boolean; message: string }> {
    const settings = await this.getAll();
    return { enabled: settings.maintenanceMode, message: settings.maintenanceMessage };
  }

  async get<K extends PlatformSettingKey>(key: K): Promise<PlatformSettings[K]> {
    const rows = await this.loadRows();
    return this.resolve(key, rows);
  }

  async getAll(): Promise<PlatformSettings> {
    const rows = await this.loadRows();
    const settings = {} as Record<PlatformSettingKey, unknown>;
    for (const key of SETTING_KEYS) {
      settings[key] = this.resolve(key, rows);
    }
    return settings as unknown as PlatformSettings;
  }

  /**
   * Settings plus where each value comes from, for the back-office
   */
  async getAdminView(): Promise<{ settings: PlatformSettings; meta: Record<PlatformSettingKey, SettingMeta> }> {
    const rows = await this.loadRows();
    const settings = {} as Record<PlatformSettingKey, unknown>;
    const meta = {} as Record<PlatformSettingKey, SettingMeta>;

    for (const key of SETTING_KEYS) {
      settings[key] = this.resolve(key, rows);
      const row = rows.get(key);
      const envRaw = this.configService.get<string>(SETTING_DEFINITIONS[key].env);
      meta[key] = {
        source: row && this.coerce(key, row.value) !== undefined ? 'database' : envRaw !== undefined && envRaw !== '' ? 'environment' : 'default',
        fallbackValue: this.fallback(key),
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    }

    return { settings: settings as unknown as PlatformSettings, meta };
  }

  /**
   * Update some settings. Returns the list of effective changes (old/new values).
   */
  async update(
    adminId: string,
    changes: Partial<PlatformSettings>,
  ): Promise<Partial<Record<PlatformSettingKey, { from: unknown; to: unknown }>>> {
    const current = await this.getAll();
    const diff: Partial<Record<PlatformSettingKey, { from: unknown; to: unknown }>> = {};

    for (const key of SETTING_KEYS) {
      if (!(key in changes) || changes[key] === undefined) continue;
      const value = this.validate(key, changes[key]);
      if (value !== current[key]) {
        diff[key] = { from: current[key], to: value };
      }
    }

    const keys = Object.keys(diff) as PlatformSettingKey[];
    if (keys.length) {
      await this.prisma.$transaction(
        keys.map((key) =>
          this.prisma.platformSetting.upsert({
            where: { key },
            create: { key, value: diff[key]!.to as any, updatedBy: adminId },
            update: { value: diff[key]!.to as any, updatedBy: adminId },
          }),
        ),
      );
      this.invalidate();
      await this.logChange(adminId, 'SETTINGS_UPDATED', diff);
    }

    return diff;
  }

  /**
   * Remove the database override of a setting so it falls back to the environment
   */
  async reset(adminId: string, key: PlatformSettingKey): Promise<{ from: unknown; to: unknown }> {
    if (!SETTING_KEYS.includes(key)) {
      throw new BadRequestException(`Paramètre inconnu : ${key}`);
    }
    const from = await this.get(key);
    await this.prisma.platformSetting.deleteMany({ where: { key } });
    this.invalidate();
    const change = { from, to: this.fallback(key) };
    await this.logChange(adminId, 'SETTINGS_RESET', { [key]: change });
    return change;
  }

  invalidate() {
    this.cache = null;
  }

  // ==================== Internals ====================

  /** Audit-log a settings change. Never fails the calling action. */
  private async logChange(adminId: string, action: string, changes: Record<string, { from: unknown; to: unknown }>) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action,
          resource: 'SETTINGS',
          resourceId: Object.keys(changes).join(','),
          metadata: { changes } as any,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${action}: ${error.message}`);
    }
  }

  private async loadRows() {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.rows;
    }
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const rows = await this.prisma.platformSetting.findMany();
          const map = new Map(
            rows.map((row) => [row.key, { value: row.value as unknown, updatedAt: row.updatedAt, updatedBy: row.updatedBy }]),
          );
          this.cache = { rows: map, expiresAt: Date.now() + CACHE_TTL_MS };
          return map;
        } catch (error) {
          // Never break payments/auth because settings can't be read: use env values
          this.logger.error(`Failed to load platform settings: ${error.message}`);
          return new Map();
        } finally {
          this.loading = null;
        }
      })();
    }
    return this.loading;
  }

  private resolve<K extends PlatformSettingKey>(key: K, rows: Map<string, { value: unknown }>): PlatformSettings[K] {
    const row = rows.get(key);
    if (row) {
      const value = this.coerce(key, row.value);
      if (value !== undefined) return value;
    }
    return this.fallback(key);
  }

  private fallback<K extends PlatformSettingKey>(key: K): PlatformSettings[K] {
    const definition = SETTING_DEFINITIONS[key];
    const envValue = this.coerce(key, this.configService.get<string>(definition.env));
    return envValue !== undefined ? envValue : definition.default;
  }

  /** Convert a raw (env string or JSON) value into the setting type, undefined when invalid */
  private coerce<K extends PlatformSettingKey>(key: K, raw: unknown): PlatformSettings[K] | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const definition = SETTING_DEFINITIONS[key];

    switch (definition.type) {
      case 'number': {
        const value = typeof raw === 'number' ? raw : parseFloat(String(raw));
        return (Number.isFinite(value) ? value : undefined) as PlatformSettings[K] | undefined;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') return raw as PlatformSettings[K];
        const normalized = String(raw).trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true as PlatformSettings[K];
        if (['false', '0', 'no', 'off'].includes(normalized)) return false as PlatformSettings[K];
        return undefined;
      }
      default:
        return String(raw) as PlatformSettings[K];
    }
  }

  private validate<K extends PlatformSettingKey>(key: K, value: unknown): PlatformSettings[K] {
    const definition = SETTING_DEFINITIONS[key];
    const coerced = this.coerce(key, value);
    if (coerced === undefined || typeof coerced !== definition.type) {
      throw new BadRequestException(`Valeur invalide pour ${key}`);
    }
    if (definition.type === 'number') {
      const n = coerced as number;
      if ((definition.min !== undefined && n < definition.min) || (definition.max !== undefined && n > definition.max)) {
        throw new BadRequestException(`${key} doit être compris entre ${definition.min} et ${definition.max}`);
      }
      return (Math.round(n * 100) / 100) as PlatformSettings[K];
    }
    if (definition.type === 'string') {
      const s = (coerced as string).trim();
      if (!s || (definition.maxLength && s.length > definition.maxLength)) {
        throw new BadRequestException(`${key} doit contenir entre 1 et ${definition.maxLength} caractères`);
      }
      return s as PlatformSettings[K];
    }
    return coerced;
  }
}
