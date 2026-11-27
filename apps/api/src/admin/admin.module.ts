import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { LessonsController } from './lessons.controller';

@Module({
  controllers: [AdminController, LessonsController],
  providers: [AdminService],
})
export class AdminModule {}
