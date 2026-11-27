import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  controllers: [QuizController],
  providers: [QuizService, AiClientService],
})
export class QuizModule {}
