import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfirmPaymentDto, OneTimePaymentDto } from '../payments/dto/payments.dto';
import { paymentContext } from '../payments/payment-context';
import { Request } from 'express';
import { AgeVerified } from '../age-verification/decorators/age-verified.decorator';
import { gateMessagePage } from '../age-verification/age-gate';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(
    private messagingService: MessagingService,
    private messagingGateway: MessagingGateway,
  ) {}

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

  /**
   * People the user can start a conversation with ("Nouveau message" picker)
   */
  @Get('contacts')
  searchContacts(@CurrentUser('id') userId: string, @Query('q') query?: string) {
    return this.messagingService.searchContacts(userId, query);
  }

  /**
   * Send a message (text, attachment, PPV price) and push it in real time
   */
  @Post()
  async sendMessage(@CurrentUser('id') userId: string, @Body() dto: SendMessageDto) {
    const message = await this.messagingService.sendMessage(
      userId,
      dto.recipientId,
      dto.content ?? '',
      dto.attachmentUrl,
      { ppvPrice: dto.ppvPrice },
    );

    this.messagingGateway.emitNewMessage(
      dto.recipientId,
      this.messagingGateway.toMessagePayload(message, dto.recipientId),
    );
    this.messagingGateway.emitToUser(userId, 'message:sent', {
      message: this.messagingGateway.toMessagePayload(message, userId),
    });

    return this.messagingGateway.toMessagePayload(message, userId);
  }

  /**
   * Mark the conversation with a user as read and notify them (read receipts)
   */
  @Post(':partnerId/read')
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
  ) {
    const result = await this.messagingService.markConversationRead(userId, partnerId);
    if (result.count > 0) {
      this.messagingGateway.emitToUser(partnerId, 'message:read', {
        messageIds: result.messageIds,
        readBy: userId,
      });
    }
    return result;
  }

  /**
   * Buy a PPV message: completes right away with a saved card, or returns
   * the provider's payment page to redirect to
   */
  @Post(':messageId/unlock')
  unlockMessage(
    @CurrentUser('id') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: OneTimePaymentDto,
    @Req() request: Request,
  ) {
    return this.messagingService.unlockMessage(userId, messageId, { ...dto, ...paymentContext(request) });
  }

  /**
   * State of the PPV message payment (idempotent)
   */
  @Post(':messageId/unlock/confirm')
  confirmUnlockMessage(
    @CurrentUser('id') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.messagingService.confirmUnlockMessage(userId, messageId, dto.transactionId);
  }

  @Get(':partnerId')
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @AgeVerified() ageVerified: boolean,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const result = await this.messagingService.getMessages(
      userId,
      partnerId,
      page ? parseInt(page) || 1 : 1,
      limit ? parseInt(limit) || 50 : 50,
      before,
    );
    // Attachments received from the partner need a verified age
    return gateMessagePage(result, { viewerId: userId, ageVerified });
  }

  @Delete(':messageId')
  async deleteMessage(
    @CurrentUser('id') userId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const result = await this.messagingService.deleteMessage(messageId, userId);
    const payload = { messageId, senderId: userId, receiverId: result.receiverId };
    this.messagingGateway.emitToUser(result.receiverId, 'message:deleted', payload);
    this.messagingGateway.emitToUser(userId, 'message:deleted', payload);
    return result;
  }
}
