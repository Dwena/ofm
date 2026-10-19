import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StreamingService } from './streaming.service';
import { StreamingController } from './streaming.controller';
import { StreamingGateway } from './streaming.gateway';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [StreamingController],
  providers: [StreamingService, StreamingGateway],
  exports: [StreamingService, StreamingGateway],
})
export class StreamingModule {}
