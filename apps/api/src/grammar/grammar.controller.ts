import { Controller, Post, Body, UseGuards, Headers, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { GrammarService } from './grammar.service';
import { ExplainGrammarDto } from './dto/grammar.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { TokensService } from '../tokens/tokens.service';

@ApiTags('Grammar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('grammar')
export class GrammarController {
  constructor(
    private grammarService: GrammarService,
    private tokensService: TokensService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}

  @Post('explain')
  @ApiOperation({ summary: 'Get AI grammar explanation' })
  @RateLimit({ limit: 20, window: 60, keyPrefix: 'grammar_explain' })
  async explain(
    @CurrentUser('id') userId: string,
    @Body() dto: ExplainGrammarDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Scope client-supplied idempotency keys to this user so another account's
    // key cannot be replayed to skip token consumption. Hashing with the JWT
    // secret keeps the key opaque and stable across retries for the same user.
    const scopedKey = idempotencyKey
      ? createHash('sha256')
          .update(`${this.config.get<string>('JWT_SECRET') || ''}:${userId}:grammar_explain:${idempotencyKey}`)
          .digest('hex')
      : undefined;

    await this.tokensService.consumeTokens(userId, 'grammar_explain', undefined, scopedKey);
    return this.grammarService.explain(dto);
  }
}
