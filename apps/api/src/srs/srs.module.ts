import { Module } from '@nestjs/common';
import { SrsService } from './srs.service';
import { SrsController } from './srs.controller';
import { SrsReminderService } from './srs-reminder.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [SrsController],
  providers: [SrsService, SrsReminderService],
  exports: [SrsService],
})
export class SrsModule {}
