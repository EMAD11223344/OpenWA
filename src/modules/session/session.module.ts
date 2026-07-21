import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { WebhookModule } from '../webhook/webhook.module';
import { EngineWatchdogService } from '../../core/engine-watchdog.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([Session], 'data'), forwardRef(() => WebhookModule), ConfigModule],
  controllers: [SessionController],
  providers: [SessionService, EngineWatchdogService],
  exports: [SessionService, EngineWatchdogService],
})
export class SessionModule {}
