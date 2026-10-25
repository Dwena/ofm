import { Module } from '@nestjs/common';
import { AdminTaxController, TaxController } from './tax.controller';
import { TaxProfileService } from './tax-profile.service';
import { TaxReminderService } from './tax-reminder.service';
import { TaxDataService } from './tax-data.service';
import { SelfBillingService } from './self-billing.service';
import { TaxStatementsService } from './tax-statements.service';

/**
 * Tax compliance of the creators' income: tax profile (DAC7 identity, bank
 * account, self-billing mandate), monthly self-billing invoices, annual
 * statements (art. 242 bis CGI) and the DAC7 export.
 *
 * Exports TaxProfileService for the payments module (isComplete,
 * getPayoutBankDetails). PrismaService and MailService are global.
 */
@Module({
  controllers: [TaxController, AdminTaxController],
  providers: [TaxProfileService, TaxReminderService, TaxDataService, SelfBillingService, TaxStatementsService],
  exports: [TaxProfileService],
})
export class TaxModule {}
