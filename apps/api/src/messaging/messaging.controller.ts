import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StartConversationDto } from './dto/start-conversation.dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private messagingService: MessagingService) {}

  @Get('conversations')
  getConversations(@CurrentUser('id') userId: string) {
    return this.messagingService.getConversations(userId);
  }

  /**
   * Open (or create) the conversation with a user, given its id or username
   */
  @Post('conversations')
  startConversation(@CurrentUser('id') userId: string, @Body() dto: StartConversationDto) {
    return this.messagingService.startConversation(userId, dto.user);
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
