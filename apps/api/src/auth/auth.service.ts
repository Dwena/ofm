import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { nanoid } from 'nanoid';

import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Enable2FaDto } from './dto/enable-2fa.dto';
import { Verify2FaDto } from './dto/verify-2fa.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, username, password, role } = registerDto;

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

    // TODO: Send verification email

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
      name: `OFM (${user.email})`,
      issuer: 'OFM',
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

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
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
    let expirationDate = new Date();
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

  private async hashPassword(password: string): Promise<string> {
    const rounds = parseInt(
      this.configService.get('BCRYPT_ROUNDS', '12'),
    );
    return bcrypt.hash(password, rounds);
  }
}
