import { Module } from '@nestjs/common';
import { WritingService } from './writing.service';
import { WritingController } from './writing.controller';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  controllers: [WritingController],
  providers: [WritingService, AiClientService],
})
export class WritingModule {}
