import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import 'winston-daily-rotate-file';
import { join } from 'path';
import { isIP } from 'net';
import type { Server as HttpServer } from 'http';
import { requestContextStorage } from './common/utils/request-context';
import { AppModule } from './app.module';

/**
 * SEC-05 helpers are pure and exported for unit tests. They intentionally do
 * not boot NestJS.
 *
 * Reverse-proxy requirements for these settings to hold:
 * - Terminate TLS at the proxy and forward the original scheme/host (the API
 *   logs `http://localhost:${port}` locally, but browsers connect over HTTPS).
 *   The auth controller sets Secure on the refresh cookie unconditionally, so
 *   plain HTTP between browser and edge will not store that cookie.
 * - Route `/api/*` and `/uploads/*` same-origin through the proxy (or add a
 *   concrete cross-origin origin to CORS_ORIGINS). A host-only, SameSite=Lax
 *   refresh cookie cannot work across unrelated sites without a deliberate
 *   Domain/SameSite=None + Secure change in the auth slice.
 * - Set TRUSTED_PROXIES to the proxy hop's IP/CIDR only (comma-separated), so
 *   Express honours X-Forwarded-* from that hop and not from arbitrary clients.
 *   Never set it to `true` (that trusts every peer). The rate-limit guard uses
 *   the same variable to select a fixed forwarded hop.
 * - The proxy should add HSTS over HTTPS, enforce body/request-size and burst
 *   limits, avoid wildcard CORS responses of its own, and disable buffering
 *   with a long read timeout for SSE routes.
 */
export function parseAllowedOrigins(
  raw: string | undefined,
  options: { production?: boolean; allowInsecureHttp?: boolean } = {},
): string[] {
  const production =
    options.production ?? process.env.NODE_ENV === 'production';
  const allowInsecureHttp =
    options.allowInsecureHttp ??
    process.env.ALLOW_INSECURE_HTTP_ORIGINS === 'true';
  const values = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid: string[] = [];
  const origins: string[] = [];

  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      invalid.push(value);
      continue;
    }
    // Only scheme + host is an origin. Reject userinfo, paths, queries and
    // fragments: echoing those in Access-Control-Allow-Origin is unsafe and
    // never matches a browser Origin header.
    const hasExtras =
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash;
    const isHttps = url.protocol === 'https:';
    const isHttp = url.protocol === 'http:';
    // Browsers send an Origin with a concrete host. A wildcard host in config
    // would be echoed verbatim, which cannot match and must fail fast.
    const hostnameIsConcrete =
      url.hostname.length > 0 && !url.hostname.includes('*');
    if (
      hasExtras ||
      !hostnameIsConcrete ||
      !(isHttps || (isHttp && (!production || allowInsecureHttp)))
    ) {
      invalid.push(value);
      continue;
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }

  if (invalid.length > 0) {
    throw new Error(
      `CORS_ORIGINS contains invalid origin(s): ${invalid.join(', ')}`,
    );
  }
  if (production && origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must contain at least one origin in production',
    );
  }
  return origins;
}

/**
 * Parse TRUSTED_PROXIES into a list Express can use for `trust proxy`.
 * Accepts exact IPv4/IPv6 addresses and IPv4/IPv6 CIDRs; an empty or invalid
 * value means no proxy is trusted. `true` or wildcard-style entries are never
 * accepted, since they let a client forge the forwarded client IP.
 */
export function parseTrustedProxies(raw: string | undefined): string[] {
  const proxies: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim();
    if (!value) continue;
    const [address, bits, ...rest] = value.split('/');
    if (rest.length > 0 || isIP(address) === 0) {
      throw new Error(`TRUSTED_PROXIES contains invalid entry: ${value}`);
    }
    if (bits !== undefined) {
      const prefix = Number(bits);
      const maxPrefix = isIP(address) === 6 ? 128 : 32;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        throw new Error(`TRUSTED_PROXIES contains invalid entry: ${value}`);
      }
    }
    if (!proxies.includes(value)) proxies.push(value);
  }
  return proxies;
}

const REQUIRED_COOKIE_ATTRIBUTES = [
  'httponly',
  'secure',
  'samesite=lax',
  'path=/',
];

/**
 * Best-effort hardening of every Set-Cookie emitted by controllers. Cookies
 * are issued outside this slice, so this adds any missing security attribute
 * without renaming cookies or changing their values. Existing stricter
 * attributes (e.g. SameSite=None for a deliberate cross-site flow) are kept.
 */
export function hardenSetCookieHeaders(headers: string[]): string[] {
  return headers.map((header) => {
    const firstSemicolon = header.indexOf(';');
    if (firstSemicolon === -1) return header;
    const pair = header.slice(0, firstSemicolon);
    const name = pair.split('=', 1)[0].trim();
    if (!name) return header;

    // Only attributes after the cookie pair are inspected. Cookie values may
    // legitimately contain '=' and must be preserved verbatim.
    const attributes = header
      .slice(firstSemicolon + 1)
      .split(';')
      .map((attribute) => attribute.trim())
      .filter(Boolean);
    if (attributes.some((attribute) => !COOKIE_ATTRIBUTE.test(attribute))) {
      return header;
    }
    const present = new Set(
      attributes.map((attribute) => attribute.split('=', 1)[0].toLowerCase()),
    );
    for (const required of REQUIRED_COOKIE_ATTRIBUTES) {
      if (!present.has(required.split('=', 1)[0])) {
        attributes.push(mapAttribute(required));
      }
    }
    return `${pair}; ${attributes.join('; ')}`;
  });
}

const COOKIE_ATTRIBUTE =
  /^(?:[A-Za-z][A-Za-z0-9-]*|#[A-Za-z][A-Za-z0-9-]*)(?:=.*)?$/;

function mapAttribute(attribute: string): string {
  switch (attribute) {
    case 'httponly':
      return 'HttpOnly';
    case 'secure':
      return 'Secure';
    case 'samesite=lax':
      return 'SameSite=Lax';
    case 'path=/':
      return 'Path=/';
    default:
      return attribute;
  }
}

/**
 * REL-30 shutdown orchestration. Kept in main.ts (the only file in this
 * slice's scope) and exported so the handlers can be unit-tested without
 * booting Nest. The close path is idempotent: a second signal or a concurrently
 * fired hook never closes the same app twice.
 */
export interface ShutdownHandle {
  start(): Promise<void>;
  close(signal?: string): Promise<void>;
  isClosing(): boolean;
}

export interface ShutdownResources {
  closeHttp?(): Promise<void>;
  closeCacheRedis?(): Promise<void>;
  closeApp(): Promise<void>;
  /** Lets the drain wait for in-flight requests before tearing down clients. */
  getHttpServer?(): HttpServer | undefined;
  closeLivenessSockets?(): Promise<void>;
}

/**
 * Wait for active HTTP requests/SSE streams with a hard ceiling. Nest closes
 * the listener when app.close() runs, so this waits only for work already
 * accepted, never for new connections. Long-lived streams are cut off at the
 * deadline by closeAllConnections().
 */
export function waitForHttpDrain(
  server: HttpServer | undefined,
  timeoutMs: number,
  sampleMs = 50,
): Promise<void> {
  if (!server || typeof server.getConnections !== 'function') {
    return Promise.resolve();
  }
  const deadline = Date.now() + Math.max(0, timeoutMs);
  return new Promise((resolve) => {
    const check = () => {
      server.getConnections((error, count) => {
        // getConnections counts accepted sockets, not the listening socket:
        // zero is the only "fully drained" state.
        if (error || count <= 0 || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(
          check,
          Math.min(sampleMs, Math.max(1, deadline - Date.now())),
        );
      });
    };
    check();
  });
}

/** Release idle keep-alive sockets so only active work is counted as in-flight. */
function closeIdleHttpConnections(server: HttpServer | undefined): void {
  const closeIdle = server?.closeIdleConnections;
  if (typeof closeIdle !== 'function') return;
  try {
    closeIdle.call(server);
  } catch {
    // A partially initialized server may reject this; app.close() still ran.
  }
}

export function parseShutdownTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw ?? 10_000);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 120_000
    ? parsed
    : 10_000;
}

export function createShutdownHandle(
  resources: ShutdownResources,
  options: {
    logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
    timeoutMs?: number;
    onSignal?: (signal: string, handler: () => void) => void;
    offSignal?: (signal: string, handler: () => void) => void;
  } = {},
): ShutdownHandle {
  const logger = options.logger ?? new Logger('Bootstrap');
  const timeoutMs =
    options.timeoutMs ??
    parseShutdownTimeoutMs(process.env.SHUTDOWN_TIMEOUT_MS);
  // Reserve at least half of the grace period for app.close(), which runs the
  // Prisma/Redis/queue destroy hooks. A long SSE stream must not consume the
  // whole budget before dependency cleanup even begins.
  const drainTimeoutMs = Math.max(250, Math.floor(timeoutMs / 2));
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const listeners: { signal: string; handler: () => void }[] = [];
  const registerSignal =
    options.onSignal ??
    ((signal: string, handler: () => void) => {
      process.on(signal, handler);
    });
  const unregisterSignal =
    options.offSignal ??
    ((signal: string, handler: () => void) => {
      process.removeListener(signal, handler);
    });

  const close = (signal = 'manual'): Promise<void> => {
    if (closePromise) return closePromise;
    closing = true;
    logger.log(`Shutdown started (${signal}); grace=${timeoutMs}ms`);
    closePromise = (async () => {
      // Keep the listeners installed until close finishes: a second signal
      // enters close() again but receives the same promise instead of spawning
      // a second app.close(). They are removed in the finally block below.
      try {
        await resources.closeHttp?.();
        // Idle keep-alive sockets are not work; releasing them lets the
        // connection count track only requests that are still in flight.
        closeIdleHttpConnections(resources.getHttpServer?.());
      } catch (error) {
        logger.warn(`HTTP drain failed: ${(error as Error).message}`);
      }

      /**
       * app.close() calls onModuleDestroy on PrismaService, RedisService, the
       * queue providers and every other Nest provider, then closes the HTTP
       * adapter and the ws adapter (which terminates speaking sockets).
       * Nest closes the listeners only after the adapter's pending
       * connections finish; the deadline below bounds the entire shutdown.
       */
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        await Promise.race([
          (async () => {
            // Only tear down the cache client after in-flight HTTP work has
            // finished; active requests may still read through the cache.
            // Use drainTimeoutMs (half the budget) so app.close() gets the
            // other half to run dependency cleanup hooks.
            await waitForHttpDrain(resources.getHttpServer?.(), drainTimeoutMs);
            try {
              await resources.closeCacheRedis?.();
            } catch (error) {
              logger.warn(
                `Cache Redis close failed: ${(error as Error).message}`,
              );
            }
            await resources.closeApp();
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error('shutdown deadline exceeded'));
            }, timeoutMs);
          }),
        ]);
        logger.log('Shutdown complete');
      } catch (error) {
        logger.error(
          `Shutdown deadline reached: ${(error as Error).message}; ` +
            'remaining work must be recovered on restart',
        );
      } finally {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          // Hard release after the grace period. Never leave retry timers or
          // open sockets holding the process after the orchestrator timeout.
          closeIdleHttpConnections(resources.getHttpServer?.());
          try {
            await resources.closeLivenessSockets?.();
          } catch (error) {
            logger.warn(
              `Forced socket close failed: ${(error as Error).message}`,
            );
          }
        }
        for (const { signal: name, handler } of listeners) {
          try {
            unregisterSignal(name, handler);
          } catch {
            // Signal unsubscription is best-effort; the close is idempotent.
          }
        }
        listeners.length = 0;
      }
    })();
    return closePromise;
  };

  const start = async (): Promise<void> => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      const handler = () => {
        void close(signal);
      };
      try {
        registerSignal(signal, handler);
        listeners.push({ signal, handler });
      } catch (error) {
        logger.warn(
          `Could not register ${signal}: ${(error as Error).message}`,
        );
      }
    }
  };

  return { start, close, isClosing: () => closing };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
          ),
        }),
        ...(process.env.NODE_ENV === 'production'
          ? [
              new (winston.transports as any).DailyRotateFile({
                dirname: 'logs',
                filename: 'api-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxFiles: '14d',
                format: winston.format.combine(
                  winston.format.timestamp(),
                  winston.format.json(),
                ),
              }),
            ]
          : []),
      ],
    }),
  });
  const logger = new Logger('Bootstrap');

  // Tells the orchestrator to stop routing new traffic here while we drain.
  // Liveness stays 200 (the process is alive); readiness performs its real
  // dependency checks and is not faked by this flag.
  let draining = false;
  app.use((req: any, res: any, next: any) => {
    if (draining) {
      // Raw Express middleware cannot throw a Nest HttpException (no exception
      // filter runs here), so write the 503 directly. Never echo the URL: it
      // may carry tokens or other request-specific data.
      res.setHeader('Connection', 'close');
      res.setHeader('Retry-After', '10');
      res.status(503).json({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Server is shutting down',
      });
      return;
    }
    next();
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // Only a configured proxy hop may supply X-Forwarded-* (and therefore the
  // client IP used for rate limits). Express never trusts all peers here.
  const trustedProxies = parseTrustedProxies(process.env.TRUSTED_PROXIES);
  if (trustedProxies.length > 0) {
    app.set('trust proxy', trustedProxies);
  }

  // Wildcards are invalid when credentials are enabled: the browser rejects
  // an echoed Origin together with Access-Control-Allow-Credentials: true.
  // Canonicalize to scheme+host and fail fast on typos in production.
  const allowedOrigins = (() => {
    const raw = process.env.CORS_ORIGINS;
    if (process.env.NODE_ENV !== 'production' && !raw) {
      return ['http://localhost:3000'];
    }
    return parseAllowedOrigins(raw);
  })();
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Idempotency-Key is sent by browser clients on every paid AI request;
    // omitting it from the preflight allow-list silently disables idempotency.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-timezone-offset',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });

  // Controllers set the refresh cookie themselves (auth.controller.ts). Add
  // any missing attributes at the response boundary so no path can emit a
  // session cookie without HttpOnly/Secure/SameSite/Path. Never rename or
  // rewrite cookie values.
  app.use((req: any, res: any, next: any) => {
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name: string, value: any) => {
      if (name.toLowerCase() === 'set-cookie') {
        const values = Array.isArray(value) ? value : [value];
        return setHeader(name, hardenSetCookieHeaders(values.map(String)));
      }
      return setHeader(name, value);
    };
    next();
  });

  app.setGlobalPrefix('api');

  // Uploaded files are public assets (avatars, lesson audio). Keep the path
  // in sync with FilesService/UsersService, which write into CWD/uploads.
  // Prevent a browser from sniffing an uploaded file as executable HTML when
  // it is opened directly by URL.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    setHeaders(res: any) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // API versioning: /api/v1/... for future backward compatibility
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Request ID middleware: attaches a unique ID to every request for tracing.
  // Generate server-side by default; only a strictly shaped inbound ID is
  // propagated, so newlines/oversized values cannot forge log lines or audit
  // correlations. Everything else is replaced with a fresh UUID.
  const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
  const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
  app.use((req: any, res: any, next: any) => {
    const inbound = req.get?.('x-request-id') as string | undefined;
    const requestId =
      inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : uuidv4();
    const key = req.get?.('idempotency-key') as string | undefined;
    const idempotencyKey =
      key && IDEMPOTENCY_KEY_PATTERN.test(key) ? key : undefined;
    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    // Services that cannot take the header as a parameter (e.g. the cards
    // generation service) can still scope token debits to the client key.
    requestContextStorage.run({ requestId, idempotencyKey } as any, () =>
      next(),
    );
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger: enabled by default in non-production. In production it must be
  // explicitly opted in via SWAGGER_ENABLED=true to avoid leaking the API surface.
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('LinguaAI API')
      .setDescription('Smart Language Learning Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger UI mounted at /api/docs');
  }

  app.useWebSocketAdapter(new WsAdapter(app));

  const httpServer = app.getHttpServer() as HttpServer;

  const shutdown = createShutdownHandle(
    {
      closeHttp: async () => {
        draining = true;
        logger.log('Stopped accepting new requests');
      },
      closeCacheRedis: async () => {
        // CacheModule has no OnModuleDestroy hook. Its redis-yet store exposes
        // the underlying node-redis client; close it so no socket is left open
        // and node-redis retry timers cannot keep the process alive.
        const cache = app.get<any>(CACHE_MANAGER);
        const client = (
          cache?.store as { client?: { quit?: () => Promise<void> } }
        )?.client;
        if (typeof client?.quit === 'function') {
          await client.quit();
        }
      },
      closeApp: () => app.close(),
      getHttpServer: () => httpServer,
      closeLivenessSockets: async () => {
        httpServer.closeAllConnections?.();
      },
    },
    { logger },
  );

  // AppModule's guards, CORS, pipes, versioning and Swagger wiring stay
  // untouched. The signal handler owns the single idempotent close path.
  await shutdown.start();
  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

// Only start the server when this file is the process entry point; importing
// the pure SEC-05 helpers in unit tests must not bind a port.
if (require.main === module) {
  bootstrap();
}
