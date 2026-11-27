import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { GroqService } from '../common/services/groq.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, GroqService],
})
export class ChatModule {}
