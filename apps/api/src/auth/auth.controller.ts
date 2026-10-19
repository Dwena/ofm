import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Put,
  Delete,
  Headers,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Verify2FaDto } from './dto/verify-2fa.dto';
import { EmailDto, ResetPasswordDto, VerifyEmailDto } from './dto/email-token.dto';
import { ChangePasswordDto, DeleteAccountDto } from './dto/account.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser('id') userId: string,
    @Headers('authorization') authorization: string,
  ) {
    const token = authorization?.replace('Bearer ', '');
    return this.authService.logout(userId, token);
  }

  @Post('verify-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Post('resend-verification')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async resendVerification(@Body() emailDto: EmailDto) {
    return this.authService.resendVerification(emailDto.email);
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgotPassword(@Body() emailDto: EmailDto) {
    return this.authService.forgotPassword(emailDto.email);
  }

  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return { user };
  }

  /** Change the password (current password required). Returns fresh tokens. */
  @Put('password')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, changePasswordDto);
  }

  /** Sign out of every device (all refresh and access tokens revoked) */
  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser('id') userId: string) {
    return this.authService.logoutAll(userId);
  }

  /** Soft-delete the current account (password + 2FA code when enabled) */
  @Delete('account')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Body() deleteAccountDto: DeleteAccountDto,
  ) {
    return this.authService.deleteAccount(userId, deleteAccountDto);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  async enable2FA(@CurrentUser('id') userId: string) {
    return this.authService.enable2FA(userId);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  async verify2FA(
    @CurrentUser('id') userId: string,
    @Body() verify2FaDto: Verify2FaDto,
  ) {
    return this.authService.verify2FASetup(userId, verify2FaDto);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  async disable2FA(
    @CurrentUser('id') userId: string,
    @Body() verify2FaDto: Verify2FaDto,
  ) {
    return this.authService.disable2FA(userId, verify2FaDto);
  }
}
