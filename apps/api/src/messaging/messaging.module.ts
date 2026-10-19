import { Module } from '@nestjs/common';
import { MessagingGateway } from './messaging.gateway';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { JwtModule } from '@nestjs/jwt';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PaymentsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [MessagingController],
  providers: [MessagingGateway, MessagingService],
  exports: [MessagingGateway, MessagingService],
})
export class MessagingModule {}
