import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [QuizController],
  providers: [QuizService, AiClientService],
})
export class QuizModule {}
