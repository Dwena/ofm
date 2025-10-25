import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private messagingService: MessagingService) {}

  @Get('conversations')
  getConversations(@CurrentUser('id') userId: string) {
    return this.messagingService.getConversations(userId);
  }

  @Get(':partnerId')
  getMessages(
    @CurrentUser('id') userId: string,
    @Param('partnerId') partnerId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagingService.getMessages(
      userId,
      partnerId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Delete(':messageId')
  deleteMessage(@CurrentUser('id') userId: string, @Param('messageId') messageId: string) {
    return this.messagingService.deleteMessage(messageId, userId);
  }
}
