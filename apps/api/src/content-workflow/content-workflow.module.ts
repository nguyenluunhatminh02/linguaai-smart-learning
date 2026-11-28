import { Module } from '@nestjs/common';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentWorkflowController } from './content-workflow.controller';

@Module({
  controllers: [ContentWorkflowController],
  providers: [ContentWorkflowService],
  exports: [ContentWorkflowService],
})
export class ContentWorkflowModule {}
