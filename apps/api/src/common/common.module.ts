import { Module, Global } from '@nestjs/common';
import { RedisService } from './services/redis.service';
import { ScheduledDeleteService } from './services/scheduled-delete.service';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';

@Global()
@Module({
  imports: [],
  providers: [
    RedisService,
    ScheduledDeleteService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
  exports: [RedisService],
})
export class CommonModule {}
