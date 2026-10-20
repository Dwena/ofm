import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { StreamingGateway } from './streaming.gateway';
import { IceServersService } from './ice-servers.service';
import { LiveTipsService } from './live-tips.service';
import { LiveTipsController } from './live-tips.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PaymentsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [StreamingController, LiveTipsController],
  providers: [StreamingService, StreamingGateway, IceServersService, LiveTipsService],
  exports: [StreamingService, StreamingGateway, LiveTipsService],
})
export class StreamingModule {}
