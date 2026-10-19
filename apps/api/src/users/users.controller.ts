import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { UsersService, PROFILE_IMAGE_MAX_SIZE } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Get('stats')
  @Roles('CREATOR')
  @UseGuards(RolesGuard)
  async getStats(@CurrentUser('id') userId: string) {
    return this.usersService.getCreatorStats(userId);
  }

  // Public profile images (avatars, covers), usable in a plain <img src>
  @Public()
  @Get('profile-images/profiles/:userId/:file')
  async getProfileImage(
    @Param('userId') userId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.usersService.getProfileImage(
      `profiles/${userId}/${file}`,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Shown by the web app from another origin
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  }

  @Get(':username')
  async getUserByUsername(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROFILE_IMAGE_MAX_SIZE.avatar + 1 } }))
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.usersService.uploadProfileImage(userId, 'avatar', file, this.publicBaseUrl(req));
  }

  @Post('profile/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROFILE_IMAGE_MAX_SIZE.cover + 1 } }))
  async uploadCover(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.usersService.uploadProfileImage(userId, 'cover', file, this.publicBaseUrl(req));
  }

  /**
   * Public base URL of the API (with its prefix), e.g. http://localhost:3001/api/v1
   */
  private publicBaseUrl(req: Request): string {
    const configured = this.configService.get<string>('APP_URL');
    const prefix = this.configService.get<string>('API_PREFIX', 'api/v1');
    const origin = configured || `${req.protocol}://${req.get('host')}`;
    return `${origin.replace(/\/$/, '')}/${prefix}`;
  }
}
