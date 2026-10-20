import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  MailService,
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_MINUTES,
} from '../common/mail/mail.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Enable2FaDto } from './dto/enable-2fa.dto';
import { Verify2FaDto } from './dto/verify-2fa.dto';
import { ResetPasswordDto } from './dto/email-token.dto';
import { SettingsService } from '../settings/settings.service';
import { StripeService } from '../payments/stripe.service';
import { ChangePasswordDto, DeleteAccountDto } from './dto/account.dto';

/** Redis key holding the unix time (s) of the user's last password change. */
export const PASSWORD_CHANGED_KEY = (userId: string) => `auth:pwd-changed:${userId}`;
const PASSWORD_CHANGED_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
    private mailService: MailService,
    private settingsService: SettingsService,
    @Optional() private stripeService?: StripeService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, username, password, role } = registerDto;

    if (!(await this.settingsService.isRegistrationOpen())) {
      throw new ForbiddenException('Les inscriptions sont actuellement fermées');
    }

    // Check if user exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.username === username) {
        throw new ConflictException('Username already exists');
      }
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        role,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    // Create profile based on role
    if (role === 'CREATOR') {
      await this.prisma.creatorProfile.create({
        data: { userId: user.id },
      });
    } else {
      await this.prisma.subscriberProfile.create({
        data: { userId: user.id },
      });
    }

    this.logger.log(`New user registered: ${user.email}`);

    await this.issueEmailVerification(user);

    return {
      user,
      message: 'Registration successful. Please verify your email.',
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password, totpCode } = loginDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check user status
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Account suspended');
    }

    if (user.status === 'BANNED') {
      throw new UnauthorizedException('Account banned');
    }

    // Check 2FA
    if (user.twoFactorEnabled) {
      if (!totpCode) {
        throw new BadRequestException('2FA code required');
      }

      const isValid = await this.verify2FACode(user.id, totpCode);
      if (!isValid) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastActiveAt: new Date(),
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Save refresh token
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      ...tokens,
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      // Check if token exists and not revoked
      const tokenRecord = await this.prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });

      if (!tokenRecord || tokenRecord.isRevoked) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check expiration
      if (new Date() > tokenRecord.expiresAt) {
        throw new UnauthorizedException('Refresh token expired');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(tokenRecord.user);

      // Revoke old refresh token
      await this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { isRevoked: true, revokedAt: new Date() },
      });

      // Save new refresh token
      await this.saveRefreshToken(tokenRecord.user.id, tokens.refreshToken);

      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, accessToken: string) {
    // Revoke all refresh tokens for user
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    // Blacklist access token
    const decoded = this.jwtService.decode(accessToken) as any;
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.set(`blacklist:${accessToken}`, '1', ttl);
    }

    this.logger.log(`User logged out: ${userId}`);

    return { message: 'Logged out successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findUnique({
      where: { emailVerificationToken: this.hashToken(token) },
    });

    if (
      !user ||
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationExpires: null,
        ...(user.status === 'PENDING_VERIFICATION' && { status: 'ACTIVE' }),
      },
    });

    this.logger.log(`Email verified for user: ${user.id}`);

    return { message: 'Email verified successfully' };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, emailVerified: true, deletedAt: true },
    });

    // Same response whether or not the account exists (no user enumeration)
    if (user && !user.emailVerified && !user.deletedAt) {
      await this.issueEmailVerification(user);
    }

    return {
      message: 'If an unverified account exists for this email, a verification email has been sent.',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, status: true, deletedAt: true },
    });

    if (user && !user.deletedAt && user.status !== 'BANNED') {
      const token = this.generateToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: this.hashToken(token),
          passwordResetExpires: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
        },
      });
      await this.mailService.sendPasswordResetEmail(user.email, user.username, token);
      this.logger.log(`Password reset requested for user: ${user.id}`);
    }

    return {
      message: 'If an account exists for this email, a password reset link has been sent.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, password } = resetPasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { passwordResetToken: this.hashToken(token) },
    });

    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await this.hashPassword(password);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null,
          // The reset link proves ownership of the mailbox
          ...(!user.emailVerified && { emailVerified: true, emailVerifiedAt: now }),
          ...(user.status === 'PENDING_VERIFICATION' && { status: 'ACTIVE' }),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    // Invalidate access tokens issued before this point (checked by JwtStrategy)
    await this.redis.set(
      PASSWORD_CHANGED_KEY(user.id),
      String(Math.floor(now.getTime() / 1000)),
      PASSWORD_CHANGED_TTL_SECONDS,
    );

    await this.mailService.sendPasswordChangedEmail(user.email, user.username);

    this.logger.log(`Password reset for user: ${user.id}`);

    return { message: 'Password reset successfully' };
  }

  /**
   * True when the access token was issued before the user's last password reset.
   */
  async isTokenIssuedBeforePasswordChange(userId: string, issuedAt?: number): Promise<boolean> {
    if (!issuedAt) {
      return false;
    }
    const changedAt = await this.redis.get(PASSWORD_CHANGED_KEY(userId));
    return !!changedAt && issuedAt < parseInt(changedAt, 10);
  }

  async enable2FA(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA already enabled');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `FanVIP (${user.email})`,
      issuer: 'FanVIP',
    });

    // Save secret temporarily (not enabled yet)
    await this.redis.set(
      `2fa:temp:${userId}`,
      secret.base32,
      600, // 10 minutes
    );

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode,
      message: 'Scan the QR code with your authenticator app',
    };
  }

  async verify2FASetup(userId: string, verify2FaDto: Verify2FaDto) {
    const { code } = verify2FaDto;

    // Get temporary secret
    const secret = await this.redis.get(`2fa:temp:${userId}`);
    if (!secret) {
      throw new BadRequestException('2FA setup expired. Please try again.');
    }

    // Verify code
    const isValid = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid 2FA code');
    }

    // Save secret and enable 2FA
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret,
        twoFactorEnabled: true,
      },
    });

    // Remove temporary secret
    await this.redis.del(`2fa:temp:${userId}`);

    this.logger.log(`2FA enabled for user: ${userId}`);

    return { message: '2FA enabled successfully' };
  }

  async disable2FA(userId: string, verify2FaDto: Verify2FaDto) {
    const { code } = verify2FaDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorEnabled) {
      throw new BadRequestException('2FA not enabled');
    }

    // Verify code
    const isValid = await this.verify2FACode(userId, code);
    if (!isValid) {
      throw new BadRequestException('Invalid 2FA code');
    }

    // Disable 2FA
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
      },
    });

    this.logger.log(`2FA disabled for user: ${userId}`);

    return { message: '2FA disabled successfully' };
  }

  /**
   * Change the password of the logged-in user (current password required).
   * Every other session is revoked; fresh tokens are returned for this one.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new BadRequestException('Utilisateur introuvable');
    }

    if (!(await bcrypt.compare(dto.currentPassword, user.password))) {
      // 400 rather than 401: the session itself is valid
      throw new BadRequestException('Mot de passe actuel incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("Le nouveau mot de passe doit être différent de l'actuel");
    }

    const hashedPassword = await this.hashPassword(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);

    await this.markTokensRevoked(userId, now);

    // New tokens for the current device (issued after the revocation point)
    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(userId, tokens.refreshToken);

    await this.mailService.sendPasswordChangedEmail(user.email, user.username);
    this.logger.log(`Password changed for user: ${userId}`);

    return { message: 'Password changed successfully', ...tokens };
  }

  /** Sign out every device: refresh tokens revoked, access tokens rejected */
  async logoutAll(userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
    // + 1s: also rejects tokens issued earlier within the current second
    await this.markTokensRevoked(userId, new Date(now.getTime() + 1000));
    this.logger.log(`All sessions revoked for user: ${userId}`);
    return { message: 'Logged out from all devices' };
  }

  /**
   * Soft-delete the account of the logged-in user: personal data is anonymized,
   * content hidden, tiers deactivated, Stripe subscriptions set to end with the
   * current period, every session revoked.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new BadRequestException('Utilisateur introuvable');
    }
    if (user.role === 'ADMIN') {
      throw new ForbiddenException('Un compte administrateur ne peut pas être supprimé depuis les paramètres');
    }
    if (!(await bcrypt.compare(dto.password, user.password))) {
      throw new BadRequestException('Mot de passe incorrect');
    }
    if (user.twoFactorEnabled) {
      if (!dto.totpCode) {
        throw new BadRequestException('Code 2FA requis');
      }
      if (!(await this.verify2FACode(userId, dto.totpCode))) {
        throw new BadRequestException('Code 2FA invalide');
      }
    }

    // Stop future billing (as a fan, and for the fans of a creator)
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE', 'PAUSED'] },
        OR: [{ subscriberId: userId }, { tier: { creatorId: userId } }],
      },
      select: { id: true, stripeSubscriptionId: true },
    });
    for (const subscription of subscriptions) {
      if (!subscription.stripeSubscriptionId || !this.stripeService) continue;
      try {
        await this.stripeService.setCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);
      } catch (error: any) {
        this.logger.error(
          `Failed to schedule cancellation of ${subscription.stripeSubscriptionId}: ${error?.message ?? error}`,
        );
      }
    }

    const now = new Date();
    const anonymousId = userId.replace(/-/g, '').slice(0, 12);
    const unusablePassword = await this.hashPassword(randomBytes(32).toString('hex'));

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.invalid`,
          username: `deleted_${anonymousId}`,
          password: unusablePassword,
          displayName: 'Compte supprimé',
          bio: null,
          avatar: null,
          coverImage: null,
          location: null,
          website: null,
          phoneNumber: null,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          emailVerificationToken: null,
          emailVerificationExpires: null,
          passwordResetToken: null,
          passwordResetExpires: null,
          notificationPreferences: Prisma.DbNull,
          deletedAt: now,
        },
      }),
      this.prisma.subscription.updateMany({
        where: { id: { in: subscriptions.map((s) => s.id) } },
        data: { cancelAtPeriodEnd: true },
      }),
      this.prisma.subscriptionTier.updateMany({ where: { creatorId: userId }, data: { isActive: false } }),
      this.prisma.content.updateMany({ where: { creatorId: userId, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { creatorId: userId }] } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);

    await this.markTokensRevoked(userId, new Date(now.getTime() + 1000));
    this.logger.log(`Account deleted (soft) for user: ${userId}`);

    return { message: 'Account deleted' };
  }

  /** Access tokens issued before `at` are rejected by JwtStrategy */
  private async markTokensRevoked(userId: string, at: Date) {
    await this.redis.set(
      PASSWORD_CHANGED_KEY(userId),
      String(Math.floor(at.getTime() / 1000)),
      PASSWORD_CHANGED_TTL_SECONDS,
    );
  }

  private async verify2FACode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorSecret) {
      return false;
    }

    return speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 2,
    });
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    return this.redis.exists(`blacklist:${token}`);
  }

  private async generateTokens(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    // A unique jwtid per token: two logins of the same user within the same
    // second would otherwise produce identical tokens and collide on the
    // unique `token` columns of Session / RefreshToken
    const accessToken = this.jwtService.sign(payload, { jwtid: randomUUID() });

    const refreshToken = this.jwtService.sign(payload, {
      jwtid: randomUUID(),
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
    };
  }

  private async saveRefreshToken(userId: string, token: string) {
    const expiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d');

    // Parse expiration (e.g., "7d" -> 7 days)
    const expirationDate = new Date();
    const match = expiresIn.match(/^(\d+)([dhms])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case 'd':
          expirationDate.setDate(expirationDate.getDate() + value);
          break;
        case 'h':
          expirationDate.setHours(expirationDate.getHours() + value);
          break;
        case 'm':
          expirationDate.setMinutes(expirationDate.getMinutes() + value);
          break;
        case 's':
          expirationDate.setSeconds(expirationDate.getSeconds() + value);
          break;
      }
    }

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token,
        expiresAt: expirationDate,
      },
    });
  }

  private async issueEmailVerification(user: { id: string; email: string; username: string }) {
    const token = this.generateToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: this.hashToken(token),
        emailVerificationExpires: new Date(
          Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
        ),
      },
    });
    await this.mailService.sendVerificationEmail(user.email, user.username, token);
  }

  /** 32 random bytes as hex (64 chars). Only the SHA-256 hash is stored. */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    const rounds = parseInt(
      this.configService.get('BCRYPT_ROUNDS', '12'),
    );
    return bcrypt.hash(password, rounds);
  }
}
