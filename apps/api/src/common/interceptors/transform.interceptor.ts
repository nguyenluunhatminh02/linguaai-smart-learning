import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DateUtil } from '../utils/date.util';

export type ApiErrors = string[] | Record<string, string[]> | null;

/** Allowlisted error codes; must stay in lockstep with the global filter. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'ACCESS_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INSUFFICIENT_CREDITS'
  | 'INTERNAL_ERROR';

export interface ApiResponse<T> {
  success: boolean;
  message: string | null;
  data: T | null;
  errors: ApiErrors;
  timestamp: string;
  path: string;
}

/** Error envelope: six shared keys plus code, retryable and requestId. */
export interface ApiErrorResponse extends ApiResponse<null> {
  code: ApiErrorCode;
  retryable: boolean;
  requestId: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          'timestamp' in data &&
          'data' in data
        ) {
          return data;
        }

        let message: string | null = null;
        let responseData: any = data;

        if (data && typeof data === 'object' && 'message' in data) {
          const { message: msg, ...rest } = data as any;
          message = msg;
          responseData = Object.keys(rest).length ? rest : null;
        }

        return {
          success: true,
          message,
          data: responseData,
          errors: null,
          timestamp: DateUtil.nowISO(),
          path: request.url,
        };
      }),
    );
  }
}
