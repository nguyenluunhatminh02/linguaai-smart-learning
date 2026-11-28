import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TokensService } from './tokens.service';
import { ConsumeTokensDto } from './dto/tokens.dto';

@ApiTags('Tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get current token balance and today usage' })
  async getBalance(@Req() req: Request) {
    return this.tokensService.getBalance((req as any).user.id);
  }

  @Post('consume')
  @ApiOperation({ summary: 'Consume tokens for a feature' })
  async consumeTokens(@Req() req: Request, @Body() dto: ConsumeTokensDto) {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    return this.tokensService.consumeTokens(
      (req as any).user.id,
      dto.feature,
      dto.cost,
      idempotencyKey,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get token transaction history' })
  async getHistory(@Req() req: Request) {
    return this.tokensService.getHistory((req as any).user.id);
  }
}
