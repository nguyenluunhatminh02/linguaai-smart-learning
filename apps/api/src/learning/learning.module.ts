import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [LearningController],
  providers: [LearningService],
})
export class LearningModule {}
