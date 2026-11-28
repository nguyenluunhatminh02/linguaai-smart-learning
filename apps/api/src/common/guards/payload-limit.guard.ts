import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PAYLOAD_LIMIT_KEY,
  PayloadLimitMetadata,
} from '../decorators/payload-limit.decorator';

/** Upper bound for a declared limit, so misconfiguration cannot disable checks. */
const MAX_DECORATED_LIMIT_BYTES = 64 * 1024 * 1024;

/** A positive decimal Content-Length is the only value we trust as a size hint. */
function parseContentLength(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined;

  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Cheap early rejection for oversized request bodies.
 *
 * Content-Length is client-controlled: this guard is only a fast pre-check
 * before Redis/debit/LLM work. The definitive byte cap must come from the
 * body parser (main.ts) and Multer's fileSize/parts limits in the upload
 * controllers. Chunked or absent lengths are passed through deliberately.
 */
@Injectable()
export class PayloadLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.reflector.getAllAndOverride<PayloadLimitMetadata | undefined>(
      PAYLOAD_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const limit = configured?.bytes;
    if (typeof limit !== 'number' || limit < 1 || limit > MAX_DECORATED_LIMIT_BYTES) {
      // No usable decorator metadata (or an invalid configured limit): do not
      // reject legitimate traffic based on a broken configuration.
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const declared = parseContentLength(request?.headers?.['content-length']);
    if (declared !== undefined && declared > limit) {
      throw new PayloadTooLargeException(
        `Request body exceeds the ${limit} byte limit`,
      );
    }
    return true;
  }
}
