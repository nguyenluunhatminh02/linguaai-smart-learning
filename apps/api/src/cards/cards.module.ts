import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { DecksModule } from '../decks/decks.module';
import { AiClientService } from '../common/services/ai-client.service';

@Module({
  imports: [DecksModule],
  controllers: [CardsController],
  providers: [CardsService, AiClientService],
  exports: [CardsService],
})
export class CardsModule {}
