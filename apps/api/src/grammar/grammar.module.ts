import { Module } from '@nestjs/common';
import { GrammarService } from './grammar.service';
import { GrammarController } from './grammar.controller';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  controllers: [GrammarController],
  providers: [GrammarService, AiClientService],
})
export class GrammarModule {}
