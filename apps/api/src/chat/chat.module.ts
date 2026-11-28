import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { GroqService } from '../common/services/groq.service';
import { AiOperationsModule } from '../ai-operations/ai-operations.module';
import { AiOperationsPolicy } from '../ai-operations/ai-operations.policy';

@Module({
  imports: [AiOperationsModule],
  controllers: [ChatController],
  providers: [ChatService, GroqService, AiOperationsPolicy],
})
export class ChatModule {}
