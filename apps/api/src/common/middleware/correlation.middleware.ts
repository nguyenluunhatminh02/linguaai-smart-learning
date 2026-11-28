import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestStore, requestContextStorage } from '../utils/request-context';

/**
 * OPS-10: request correlation for NestJS.
 *
 * Assigns one validated correlation id to every HTTP request and keeps it in
 * three places:
 * - `req.requestId`, which the global exception filter already reads;
 * - the `X-Request-ID` response header, exposed to browsers by CORS;
 * - the ambient AsyncLocalStorage store, which AiClientService/GroqService and
 *   the cards token-debit path read without changing their signatures.
 *
 * Nothing here is a metric label: request/operation ids are high-cardinality
 * and must only appear in bounded logs and traces.
 */

/** Strict allow-list: printable ASCII only, no separators that can forge a log line. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Operation ids are UUIDs in the durable-operation flow. The broader allow-list
 * covers intermediate identifiers while still rejecting whitespace, control
 * characters and other header-injection vectors.
 */
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const REQUEST_ID_HEADER = 'X-Request-ID';
export const OPERATION_ID_HEADER = 'X-Operation-ID';
export const FEATURE_HEADER = 'X-AI-Feature';

/** Features are dotted `<domain>.<action>` names; keep the label small. */
const FEATURE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){0,2}$/;

export interface CorrelationHeaders {
  requestId?: string;
  operationId?: string;
  feature?: string;
  idempotencyKey?: string;
}

/**
 * Validate all caller-supplied correlation values. Returned values are either
 * an exact allow-listed input or undefined; callers generate safe fallbacks.
 * Arrays (duplicate headers) and non-string values are always rejected.
 */
export function parseCorrelationHeaders(
  headers: Record<string, unknown>,
): CorrelationHeaders {
  const read = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const requestId = read('x-request-id');
  const operationId = read('x-operation-id');
  const feature = read('x-ai-feature');
  const key = read('idempotency-key');

  return {
    ...(requestId && REQUEST_ID_PATTERN.test(requestId) ? { requestId } : {}),
    ...(operationId && OPERATION_ID_PATTERN.test(operationId)
      ? { operationId }
      : {}),
    ...(feature && feature.length <= 64 && FEATURE_PATTERN.test(feature)
      ? { feature }
      : {}),
    ...(key && /^[A-Za-z0-9._:-]{8,64}$/.test(key)
      ? { idempotencyKey: key }
      : {}),
  };
}

/**
 * Reuse an id already assigned upstream in the same process instead of
 * overwriting it. Only validated ids are accepted; a malformed value must not
 * survive as `req.requestId` (the filter revalidates it too).
 */
function storedRequestId(request: Request): string | undefined {
  const existing = (request as Request & { requestId?: unknown }).requestId;
  return typeof existing === 'string' && REQUEST_ID_PATTERN.test(existing)
    ? existing
    : undefined;
}

function setIfAbsent(res: Response, name: string, value: string): void {
  if (typeof res.getHeader !== 'function' || !res.getHeader(name)) {
    res.setHeader(name, value);
  }
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CorrelationMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = parseCorrelationHeaders(
      (req.headers ?? {}) as Record<string, unknown>,
    );
    const requestId = storedRequestId(req) ?? inbound.requestId ?? uuidv4();
    const operationId = inbound.operationId;
    (req as Request & { requestId: string }).requestId = requestId;

    setIfAbsent(res, REQUEST_ID_HEADER, requestId);
    // Only echo an operation id supplied by a trusted internal caller. Echoing
    // arbitrary client input would let a browser overwrite correlation state.
    if (operationId) setIfAbsent(res, OPERATION_ID_HEADER, operationId);

    const store: RequestStore & {
      idempotencyKey?: string;
      operationId?: string;
      feature?: string;
    } = {
      requestId,
      ...(operationId ? { operationId } : {}),
      ...(inbound.feature ? { feature: inbound.feature } : {}),
      ...(inbound.idempotencyKey
        ? { idempotencyKey: inbound.idempotencyKey }
        : {}),
    };

    // Structured, low-volume request completion log. Never log the URL, query
    // string, headers, ids as metric labels, or request bodies: they can carry
    // tokens, prompts or PII.
    const startedAt = process.hrtime.bigint();
    const logCompletion = () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const method = typeof req.method === 'string' ? req.method : 'UNKNOWN';
      const status = Number.isInteger(res.statusCode) ? res.statusCode : 0;
      const entry = JSON.stringify({
        requestId,
        ...(operationId ? { operationId } : {}),
        method,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
      });
      if (status >= 500) this.logger.error(entry);
      else if (status >= 400) this.logger.warn(entry);
      else this.logger.log(entry);
    };
    let logged = false;
    const once = () => {
      if (logged) return;
      logged = true;
      logCompletion();
    };
    res.once('finish', once);
    res.once('close', once);

    // AsyncLocalStorage propagates the store to every async continuation in
    // this request (controllers, AiClientService retries, SSE streams).
    requestContextStorage.run(store, () => next());
  }
}

export default CorrelationMiddleware;
