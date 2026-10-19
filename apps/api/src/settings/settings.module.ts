import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { SettingsService } from './settings.service';
import { AdminSettingsController, PublicSettingsController } from './settings.controller';
import { MaintenanceGuard } from './maintenance.guard';

/**
 * Platform settings (fee, payout threshold, registration, maintenance).
 * Global so payments/auth/content can inject SettingsService without importing the module.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminSettingsController, PublicSettingsController],
  providers: [SettingsService, { provide: APP_GUARD, useClass: MaintenanceGuard }],
  exports: [SettingsService],
})
export class SettingsModule {}
