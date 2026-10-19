import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from './settings.service';

/**
 * Paths that stay reachable while maintenance mode is on: health checks, authentication
 * (so admins can log in), the back-office itself, public settings and payment webhooks.
 */
const MAINTENANCE_ALLOWED = [/\/health\b/, /\/auth\//, /\/admin(\/|$)/, /\/settings\/public\b/, /webhook/i];

/**
 * Global guard: when the `maintenanceMode` platform setting is enabled, every request from a
 * non-admin is answered with 503. Admins (valid access token with role ADMIN) keep full access.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const maintenance = await this.settingsService.getMaintenance();
    if (!maintenance.enabled) return true;

    const request = context.switchToHttp().getRequest();
    const path: string = (request.originalUrl || request.url || '').split('?')[0];
    if (MAINTENANCE_ALLOWED.some((pattern) => pattern.test(path))) return true;

    if (this.isAdmin(request.headers?.authorization)) return true;

    throw new ServiceUnavailableException(maintenance.message);
  }

  private isAdmin(authorization?: string): boolean {
    if (!authorization?.startsWith('Bearer ')) return false;
    try {
      const payload = this.jwtService.verify(authorization.slice(7), {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      return payload?.role === 'ADMIN';
    } catch {
      return false;
    }
  }
}
