import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './services/redis.service';
import { ScheduledDeleteService } from './services/scheduled-delete.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import {
  LocalStorageAdapter,
  StorageAdapter,
  STORAGE_PORT,
} from '../files/storage.adapter';

@Global()
@Module({
  imports: [],
  providers: [
    RedisService,
    ScheduledDeleteService,
    CircuitBreakerService,
    {
      provide: STORAGE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageAdapter =>
        LocalStorageAdapter.fromConfig(config),
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
  exports: [RedisService, CircuitBreakerService, STORAGE_PORT],
})
export class CommonModule {}
