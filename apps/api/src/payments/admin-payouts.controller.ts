import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminPayoutBatchDto, AdminPayoutFailureDto } from './dto/payments.dto';
import { PayoutsService } from './payouts.service';

const PAYOUT_STATUSES: PayoutStatus[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Back-office of creator payouts: SEPA export, then paid / failed
 */
@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const filter = PAYOUT_STATUSES.includes(status as PayoutStatus) ? (status as PayoutStatus) : undefined;
    return this.payouts.listPayouts(filter);
  }

  /** Export pending payouts as a SEPA credit transfer file (pain.001) */
  @Post('batch')
  async createBatch(@CurrentUser('id') adminId: string, @Body() dto: AdminPayoutBatchDto) {
    return this.payouts.createBatch(adminId, dto.payoutIds);
  }

  @Post(':id/paid')
  async markPaid(@CurrentUser('id') adminId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.markPaid(adminId, id);
  }

  @Post(':id/failed')
  async markFailed(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPayoutFailureDto,
  ) {
    return this.payouts.markFailed(adminId, id, dto.reason);
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPayoutFailureDto,
  ) {
    return this.payouts.markFailed(adminId, id, dto.reason, true);
  }
}
