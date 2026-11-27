import {
  Controller, Get, Post, Patch, Delete, ForbiddenException,
  Body, Param, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { CardsService } from './cards.service';
import { DecksService } from '../decks/decks.service';
import { CreateCardDto, UpdateCardDto, GenerateCardsDto } from './dto/card.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { CurrentUser } from '../common/decorators/current-user.decorator';

/** Validated, size-bounded wrapper for the bulk-create body. Nest's global
 * ValidationPipe does not validate raw array parameters, so this DTO is
 * required to apply CreateCardDto's rules to every element. */
class BulkCreateCardsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateCardDto)
  cards: CreateCardDto[];
}

@ApiTags('Cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('decks/:deckId/cards')
export class CardsController {
  constructor(
    private cardsService: CardsService,
    private decksService: DecksService,
  ) {}

  /** Mutating cards is restricted to the deck owner. Public decks remain
   * readable by anyone (see findByDeck), but must not be editable by
   * non-owners. */
  private async requireDeckOwner(deckId: string, userId: string): Promise<void> {
    const deck = await this.decksService.findById(deckId);
    if (deck.creator_id !== userId) throw new ForbiddenException();
  }

  @Post()
  @ApiOperation({ summary: 'Add a card to a deck' })
  async create(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: CreateCardDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireDeckOwner(deckId, userId);
    return this.cardsService.create(deckId, dto);
  }

  @Post('bulk')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Add multiple cards to a deck' })
  async bulkCreate(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: BulkCreateCardsDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireDeckOwner(deckId, userId);
    return this.cardsService.bulkCreate(deckId, dto.cards);
  }

  @Post('generate-from-text')
  @ApiOperation({
    summary: 'Auto-generate flashcards from a text passage using AI',
    description:
      'Sends a source text to the AI, which extracts key vocabulary and creates flashcard pairs. ' +
      'Cards are saved directly into the deck.',
  })
  async generateFromText(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: GenerateCardsDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireDeckOwner(deckId, userId);
    return this.cardsService.generateFromText(deckId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all cards in a deck' })
  findByDeck(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.cardsService.findByDeck(deckId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a card by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.cardsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a card' })
  async update(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCardDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireDeckOwner(deckId, userId);
    return this.cardsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a card' })
  async remove(
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.requireDeckOwner(deckId, userId);
    return this.cardsService.remove(id);
  }
}
