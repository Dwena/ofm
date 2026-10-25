import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PlatformSettingKey, SettingsService } from './settings.service';
import { SettingKeyParamDto, UpdatePlatformSettingsDto } from './dto/settings.dto';

/**
 * Back-office platform settings (ADMIN only)
 */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings() {
    return this.settingsService.getAdminView();
  }

  @Put()
  async updateSettings(@CurrentUser('id') adminId: string, @Body() dto: UpdatePlatformSettingsDto) {
    const changes = await this.settingsService.update(adminId, dto);
    return { changes, ...(await this.settingsService.getAdminView()) };
  }

  /**
   * Drop the database override: the setting falls back to its environment variable
   */
  @Delete(':key')
  async resetSetting(@CurrentUser('id') adminId: string, @Param() { key }: SettingKeyParamDto) {
    const change = await this.settingsService.reset(adminId, key as PlatformSettingKey);
    return { changes: { [key]: change }, ...(await this.settingsService.getAdminView()) };
  }
}

/**
 * Public, non-sensitive settings the web app needs before login
 */
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  async getPublicSettings() {
    const settings = await this.settingsService.getAll();
    return {
      registrationOpen: settings.registrationOpen,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMode ? settings.maintenanceMessage : null,
      // Shown on the landing page (pricing explanation)
      platformFeePercentage: settings.platformFeePercentage,
      minimumPayoutAmount: settings.minimumPayoutAmount,
      earningsHoldDays: settings.earningsHoldDays,
    };
  }
}
