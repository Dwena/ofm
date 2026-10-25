import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Dac7ExportQueryDto, GenerateInvoicesDto, TaxYearQueryDto, UpdateTaxProfileDto } from './dto/tax.dto';
import { RequestContext, TaxProfileService } from './tax-profile.service';
import { SelfBillingService } from './self-billing.service';
import { TaxStatementsService, dac7ToCsv } from './tax-statements.service';

const requestContext = (req: Request): RequestContext => ({
  ipAddress: req.ip ?? null,
  userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
});

/** Creator side: tax profile, self-billing invoices, annual statements */
@Controller('tax')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CREATOR')
export class TaxController {
  constructor(
    private readonly profiles: TaxProfileService,
    private readonly selfBilling: SelfBillingService,
    private readonly statements: TaxStatementsService,
  ) {}

  @Get('profile')
  @Header('Cache-Control', 'no-store')
  getProfile(@CurrentUser('id') userId: string) {
    return this.profiles.getProfile(userId);
  }

  @Put('profile')
  @Header('Cache-Control', 'no-store')
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateTaxProfileDto, @Req() req: Request) {
    return this.profiles.updateProfile(userId, dto, requestContext(req));
  }

  @Get('invoices')
  listInvoices(@CurrentUser('id') userId: string) {
    return this.selfBilling.listForCreator(userId);
  }

  @Get('invoices/:id')
  getInvoice(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.selfBilling.getForCreator(userId, id);
  }

  /** Years for which an annual statement exists */
  @Get('annual-statements')
  listStatementYears(@CurrentUser('id') userId: string) {
    return this.statements.listStatementYears(userId);
  }

  @Get('annual-statement')
  getAnnualStatement(@CurrentUser('id') userId: string, @Query() query: TaxYearQueryDto) {
    return this.statements.getAnnualStatement(userId, query.year);
  }
}

/** Back-office: DAC7 export and catch-up of the self-billing invoices */
@Controller('admin/tax')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTaxController {
  constructor(
    private readonly selfBilling: SelfBillingService,
    private readonly statements: TaxStatementsService,
  ) {}

  /** GET /admin/tax/dac7?year=2026&format=csv|json (full IBANs: audit-logged) */
  @Get('dac7')
  async exportDac7(
    @CurrentUser('id') adminId: string,
    @Query() query: Dac7ExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const report = await this.statements.exportDac7(query.year, adminId, requestContext(req));
    res.setHeader('Cache-Control', 'no-store');
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="dac7-${query.year}.csv"`);
      res.send(dac7ToCsv(report.records));
      return;
    }
    // Same envelope as the other endpoints (@Res() bypasses the TransformInterceptor)
    res.json({ success: true, statusCode: 200, data: report, timestamp: new Date().toISOString() });
  }

  /** Generate the missing self-billing invoices of a past month (idempotent) */
  @Post('invoices/generate')
  generateInvoices(@CurrentUser('id') adminId: string, @Body() dto: GenerateInvoicesDto) {
    return this.selfBilling.generateForMonth(dto.year, dto.month, adminId);
  }

  @Get('invoices')
  listInvoices(@Query() query: GenerateInvoicesDto) {
    return this.selfBilling.listForMonth(query.year, query.month);
  }
}
