import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, ParseUUIDPipe, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DecksService } from './decks.service';
import { CreateDeckDto, UpdateDeckDto } from './dto/deck.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Decks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('decks')
export class DecksController {
  constructor(private decksService: DecksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new deck' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateDeckDto) {
    return this.decksService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all decks (own + public)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'language', required: false })
  findAll(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('language') language?: string,
  ) {
    // ParseIntPipe rejects non-numeric values; clamp to safe Prisma bounds here
    // so negative/zero/oversized values cannot cause 500s or dump the table.
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    return this.decksService.findAll(userId, safePage, safeLimit, language);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get my decks' })
  findMine(@CurrentUser('id') userId: string) {
    return this.decksService.findByUser(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deck by ID' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.decksService.findById(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a deck' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateDeckDto,
  ) {
    return this.decksService.update(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a deck' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.decksService.remove(id, userId);
  }
}
