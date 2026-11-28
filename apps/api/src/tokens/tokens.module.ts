import { Module, Global } from '@nestjs/common';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';
import { TokensReconciliationService } from './tokens-reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [TokensController],
  providers: [TokensService, TokensReconciliationService],
  exports: [TokensService, TokensReconciliationService],
})
export class TokensModule {}
