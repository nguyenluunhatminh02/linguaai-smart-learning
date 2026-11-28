import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { StorageAdapter } from './file-validation';

@Module({
  controllers: [FilesController],
  providers: [FilesService, StorageAdapter],
  exports: [FilesService, StorageAdapter],
})
export class FilesModule {}
