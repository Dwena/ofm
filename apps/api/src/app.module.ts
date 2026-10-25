import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';

// Common modules
import { DatabaseModule } from './common/database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { LoggerModule } from './common/logger/logger.module';
import { MailModule } from './common/mail/mail.module';

// Feature modules
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ContentModule } from './content/content.module';
import { PaymentsModule } from './payments/payments.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { MediaModule } from './media/media.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SocialModule } from './social/social.module';
import { AdminModule } from './admin/admin.module';
import { ModerationModule } from './moderation/moderation.module';
import { StoriesModule } from './stories/stories.module';
import { StreamingModule } from './streaming/streaming.module';
import { SettingsModule } from './settings/settings.module';
import { OverlaysModule } from './overlays/overlays.module';
import { VerificationModule } from './verification/verification.module';
import { AgeVerificationModule } from './age-verification/age-verification.module';
import { LegalModule } from './legal/legal.module';
import { TaxModule } from './tax/tax.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get('THROTTLE_TTL', 60)) * 1000, // seconds in env
          limit: Number(config.get('THROTTLE_LIMIT', 100)), // requests per ttl window
        },
      ],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Bull Queue
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          db: parseInt(process.env.REDIS_DB || '0'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 100,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      }),
    }),

    // Common modules
    DatabaseModule,
    RedisModule,
    LoggerModule,
    MailModule,
    SettingsModule,

    // Feature modules
    AuthModule,
    UsersModule,
    SubscriptionsModule,
    ContentModule,
    PaymentsModule,
    MessagingModule,
    NotificationsModule,
    StorageModule,
    MediaModule,
    AnalyticsModule,
    SocialModule,
    AdminModule,
    ModerationModule,
    StoriesModule,
    StreamingModule,
    OverlaysModule,
    VerificationModule,
    AgeVerificationModule,
    LegalModule,
    TaxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
