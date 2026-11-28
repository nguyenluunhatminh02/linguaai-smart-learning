import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * OPS-03 / OPS-08: HTTP RED metrics with strictly bounded label cardinality.
 *
 * Design constraints (from the engineering roadmap):
 * - `http_request_duration_seconds` is labelled only by route template, method
 *   and status. Raw URLs, request IDs, user IDs, IPs and headers are never
 *   recorded: they would create unbounded series and can carry secrets.
 * - Duration is observed on response `finish`/`close`, not on `next()`, so
 *   errors handled by GlobalExceptionFilter and long-lived SSE streams are
 *   measured with their final status.
 * - Registration is deliberately explicit. This file can be wired with
 *   `consumer.apply(MetricsMiddleware).forRoutes('*')` and its collector read
 *   via `MetricsMiddleware.snapshot()` / `MetricsMiddleware.prometheus()`.
 *   No other module is touched by this slice.
 *
 * No prom-client dependency is added: adding one requires a lockfile change
 * outside this slice's scope. The built-in collector exposes the parts of the
 * Prometheus text format needed for the RED metrics, including an overflow
 * series so total request count stays correct even when a route is unmatched
 * or the configured series cap is exceeded.
 */

/** Methods accepted as a label. Everything else becomes `OTHER`. */
const ALLOWED_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

type MetricMethod = (typeof ALLOWED_METHODS)[number] | 'OTHER';

/** Finite buckets in seconds, from fast reads to slow SSE/LLM requests. */
const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
] as const;

const DEFAULT_MAX_SERIES = 500;
const MAX_ROUTE_LABEL_LENGTH = 128;
const MAX_ROUTE_SEGMENT_LENGTH = 64;
const UNKNOWN_ROUTE = 'unmatched';
const OVERFLOW_ROUTE = '__overflow__';
const METRIC_NAME = 'http_request_duration_seconds';

/** Route template -> normalized template. Filled from Express's route metadata
 * (the same object Nest populates when it registers controllers), never from
 * req.url or req.path. The cache is capped by maxSeries. */
type RouteResolver = (req: Request) => string | undefined;

export interface MetricsSnapshot {
  name: string;
  help: string;
  maxSeries: number;
  overflowed: boolean;
  series: Array<{
    route: string;
    method: MetricMethod;
    status: string;
    count: number;
    sumSeconds: number;
    buckets: Array<{ le: number; count: number }>;
  }>;
}

interface Series {
  route: string;
  method: MetricMethod;
  status: string;
  count: number;
  sumSeconds: number;
  /** Length equals DURATION_BUCKETS.length; index i is the `<= le[i]` count. */
  buckets: number[];
}

/**
 * Bounded in-memory metric store. All mutating methods are synchronous, so a
 * single Node event-loop tick cannot interleave a read and a write.
 */
class HttpMetricsCollector {
  private readonly series = new Map<string, Series>();
  private overflowed = false;

  constructor(private readonly maxSeries: number) {}

  observe(
    route: string,
    method: MetricMethod,
    status: string,
    seconds: number,
  ): void {
    const key = `${route}\u0000${method}\u0000${status}`;
    let entry = this.series.get(key);
    if (!entry) {
      if (this.series.size >= this.maxSeries && !this.series.has(key)) {
        // Preserve the invariant that requests are never dropped: aggregate
        // uncapped combinations into one explicit overflow series.
        this.overflowed = true;
        const overflowKey = `${OVERFLOW_ROUTE}\u0000${method}\u0000${status}`;
        entry = this.series.get(overflowKey);
        if (!entry) {
          entry = createSeries(OVERFLOW_ROUTE, method, status);
          this.series.set(overflowKey, entry);
        }
      } else {
        entry = createSeries(route, method, status);
        this.series.set(key, entry);
      }
    }

    entry.count += 1;
    entry.sumSeconds += seconds;
    for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
      if (seconds <= DURATION_BUCKETS[i]) entry.buckets[i] += 1;
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      name: METRIC_NAME,
      help: 'HTTP request duration in seconds, labelled by bounded route/method/status.',
      maxSeries: this.maxSeries,
      overflowed: this.overflowed,
      series: [...this.series.values()]
        .sort((a, b) =>
          `${a.route}\u0000${a.method}\u0000${a.status}`.localeCompare(
            `${b.route}\u0000${b.method}\u0000${b.status}`,
          ),
        )
        .map((entry) => ({
          route: entry.route,
          method: entry.method,
          status: entry.status,
          count: entry.count,
          sumSeconds: entry.sumSeconds,
          buckets: DURATION_BUCKETS.map((le, i) => ({
            le,
            count: entry.buckets[i],
          })),
        })),
    };
  }

  /** Prometheus text exposition (`text/plain; version=0.0.4`). */
  prometheus(): string {
    const lines = [
      `# HELP ${METRIC_NAME} ${this.snapshot().help}`,
      `# TYPE ${METRIC_NAME} histogram`,
    ];
    for (const entry of this.snapshot().series) {
      const label = `route="${escapeLabel(entry.route)}",method="${entry.method}",status="${entry.status}"`;
      for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
        lines.push(
          `${METRIC_NAME}_bucket{${label},le="${DURATION_BUCKETS[i]}"} ${entry.buckets[i]}`,
        );
      }
      lines.push(
        `${METRIC_NAME}_bucket{${label},le="+Inf"} ${entry.count}`,
        `${METRIC_NAME}_sum{${label}} ${entry.sumSeconds}`,
        `${METRIC_NAME}_count{${label}} ${entry.count}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.series.clear();
    this.overflowed = false;
  }
}

function createSeries(
  route: string,
  method: MetricMethod,
  status: string,
): Series {
  return {
    route,
    method,
    status,
    count: 0,
    sumSeconds: 0,
    buckets: DURATION_BUCKETS.map(() => 0),
  };
}

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/** Only known HTTP methods are allowed as labels. */
function normalizeMethod(raw: string | undefined): MetricMethod {
  const method = (raw ?? '').toUpperCase();
  return (ALLOWED_METHODS as readonly string[]).includes(method)
    ? (method as MetricMethod)
    : 'OTHER';
}

/** Exact status codes are allowed (finite set), with `unknown` for malformed
 * responses. Never read user-controlled headers for this label. */
function normalizeStatus(raw: number | undefined): string {
  return typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= 100 &&
    raw <= 599
    ? String(raw)
    : 'unknown';
}

/**
 * Normalize an Express route template into a bounded label. Numeric ids,
 * UUIDs, long hex tokens and emails are replaced with `:id` so two routes that
 * differ only in a resource identifier share one series.
 */
export function normalizeRouteTemplate(raw: string | undefined): string {
  if (!raw || raw.length === 0) return UNKNOWN_ROUTE;

  const segments = raw
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      // Strip query/fragment defensively even though route templates never
      // include them in normal operation.
      const clean = segment.split(/[?#]/, 1)[0];
      if (clean.length === 0) return '';
      if (clean.length > MAX_ROUTE_SEGMENT_LENGTH) return ':id';
      if (
        /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i.test(
          clean,
        )
      ) {
        return ':id';
      }
      if (/^[^/@\s]+@[^/@\s]+$/.test(clean)) return ':id';
      if (clean.startsWith(':'))
        return `:${clean.slice(1).replace(/[^A-Za-z0-9_]/g, '') || 'id'}`;
      // Drop characters that would break a Prometheus label or leak a path
      // parameter value into the label.
      return clean
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[{}()[\]|,"\\<>]/g, '');
    })
    .filter((segment) => segment.length > 0);

  const template = `/${segments.join('/')}`;
  return template.length <= MAX_ROUTE_LABEL_LENGTH
    ? template
    : `${template.slice(0, MAX_ROUTE_LABEL_LENGTH - 3)}...`;
}

/**
 * Resolve the matched route template without using the unmatched URL.
 * Express sets `req.route.path` on the matched layer; Nest's router exposes
 * the composed path in `req.baseUrl + req.route.path`. If no route matched
 * (404 handled by Nest), fall back to `unmatched` rather than the raw path.
 */
const defaultResolveRoute: RouteResolver = (req) => {
  const route = (req as Request & { route?: { path?: string } }).route;
  if (!route || typeof route.path !== 'string') return undefined;
  return `${req.baseUrl ?? ''}${route.path}`;
};

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private static readonly collector = new HttpMetricsCollector(
    parseMaxSeries(process.env.METRICS_MAX_SERIES),
  );

  /**
   * Return a structured snapshot of all recorded series. Exported for a
   * future `/metrics` controller; this slice deliberately adds no route.
   */
  static snapshot(): MetricsSnapshot {
    return MetricsMiddleware.collector.snapshot();
  }

  /** Prometheus text exposition for a future scrape endpoint. */
  static prometheus(): string {
    return MetricsMiddleware.collector.prometheus();
  }

  /** Test helper; resets all series and the overflow flag. */
  static reset(): void {
    MetricsMiddleware.collector.reset();
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    let completed = false;

    const record = () => {
      if (completed) return;
      completed = true;
      const seconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const route = normalizeRouteTemplate(defaultResolveRoute(req));
      const method = normalizeMethod(req.method);
      const status = normalizeStatus(res.statusCode);
      MetricsMiddleware.collector.observe(route, method, status, seconds);
    };

    // `finish` covers normally ended responses, including responses emitted by
    // exception filters. `close` also covers aborted requests and SSE streams
    // terminated by the client; the guard above prevents double counting.
    res.once('finish', record);
    res.once('close', record);
    next();
  }
}

function parseMaxSeries(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_MAX_SERIES);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50_000
    ? parsed
    : DEFAULT_MAX_SERIES;
}
