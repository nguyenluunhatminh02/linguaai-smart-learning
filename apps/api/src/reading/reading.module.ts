import { Module } from '@nestjs/common';
import { ReadingService } from './reading.service';
import { ReadingController } from './reading.controller';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  controllers: [ReadingController],
  providers: [ReadingService, AiClientService],
})
export class ReadingModule {}
