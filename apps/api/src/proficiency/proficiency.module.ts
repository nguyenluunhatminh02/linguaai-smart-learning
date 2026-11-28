import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProficiencyController } from './proficiency.controller';
import { ProficiencyService } from './proficiency.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProficiencyController],
  providers: [ProficiencyService],
  exports: [ProficiencyService],
})
export class ProficiencyModule {}
