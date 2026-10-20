import { Module } from '@nestjs/common';
import { StreamingModule } from '../streaming/streaming.module';
import { OverlayPublicController, OverlaysController } from './overlays.controller';
import { OverlaysGateway } from './overlays.gateway';
import { OverlaysService } from './overlays.service';

/**
 * OBS overlay widgets (alerts, donation goals, tip menu, chat, requests)
 */
@Module({
  imports: [StreamingModule],
  controllers: [OverlaysController, OverlayPublicController],
  providers: [OverlaysService, OverlaysGateway],
  exports: [OverlaysService, OverlaysGateway],
})
export class OverlaysModule {}
