import { Body, Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LegalService } from './legal.service';
import { AcceptLegalDto } from './dto/accept-legal.dto';

@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  /** Current version of every legal document (public) */
  @Get('versions')
  getVersions() {
    return this.legalService.getVersions();
  }

  /** Documents the current user still has to (re-)accept */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  getStatus(@CurrentUser('id') userId: string) {
    return this.legalService.getStatus(userId);
  }

  /** Accept the current version of a document (e.g. after an update) */
  @Post('accept')
  @UseGuards(JwtAuthGuard)
  accept(
    @CurrentUser('id') userId: string,
    @Body() dto: AcceptLegalDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.legalService.accept(userId, dto.document, { ipAddress: ip, userAgent });
  }
}
