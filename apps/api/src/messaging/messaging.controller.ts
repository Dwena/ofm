import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('conversations')
  async getConversations(@CurrentUser('id') userId: string) {
    return this.messagingService.getConversations(userId);
  }

  @Get(':partnerId')
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('partnerId') partnerId: string,
  ) {
    return this.messagingService.getMessages(userId, partnerId);
  }
}
