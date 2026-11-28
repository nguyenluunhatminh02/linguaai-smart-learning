import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TokensModule } from '../tokens/tokens.module';
import { AiOperationsRepository } from './ai-operations.repository';
import { AiOperationsService } from './ai-operations.service';
import { AiOperationsPolicy } from './ai-operations.policy';

/**
 * Durable AI operation lifecycle: scoped find/create, fenced lease claim,
 * terminal transitions and refund policy hooks. No controller in this slice;
 * the exported service is consumed by the orchestrator slice.
 */
@Module({
  imports: [PrismaModule, TokensModule],
  providers: [AiOperationsRepository, AiOperationsService, AiOperationsPolicy],
  exports: [AiOperationsService],
})
export class AiOperationsModule {}
