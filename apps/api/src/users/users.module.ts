import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DatabaseModule } from '../common/database/database.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
