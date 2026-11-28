import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe, Logger, VersioningType } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { WsAdapter } from "@nestjs/platform-ws";
import { WinstonModule } from "nest-winston";
import * as winston from "winston";
import helmet from "helmet";
import * as cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import "winston-daily-rotate-file";
import { join } from "path";
import { isIP } from "net";
import { requestContextStorage } from "./common/utils/request-context";
import { AppModule } from "./app.module";

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
  const production = options.production ?? process.env.NODE_ENV === "production";
  const allowInsecureHttp =
    options.allowInsecureHttp ??
    process.env.ALLOW_INSECURE_HTTP_ORIGINS === "true";
  const values = (raw ?? "")
    .split(",")
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
      url.username || url.password || url.pathname !== "/" || url.search || url.hash;
    const isHttps = url.protocol === "https:";
    const isHttp = url.protocol === "http:";
    // Browsers send an Origin with a concrete host. A wildcard host in config
    // would be echoed verbatim, which cannot match and must fail fast.
    const hostnameIsConcrete =
      url.hostname.length > 0 && !url.hostname.includes("*");
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
      `CORS_ORIGINS contains invalid origin(s): ${invalid.join(", ")}`,
    );
  }
  if (production && origins.length === 0) {
    throw new Error(
      "CORS_ORIGINS must contain at least one origin in production",
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
  for (const entry of (raw ?? "").split(",")) {
    const value = entry.trim();
    if (!value) continue;
    const [address, bits, ...rest] = value.split("/");
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

const REQUIRED_COOKIE_ATTRIBUTES = ["httponly", "secure", "samesite=lax", "path=/"];

/**
 * Best-effort hardening of every Set-Cookie emitted by controllers. Cookies
 * are issued outside this slice, so this adds any missing security attribute
 * without renaming cookies or changing their values. Existing stricter
 * attributes (e.g. SameSite=None for a deliberate cross-site flow) are kept.
 */
export function hardenSetCookieHeaders(headers: string[]): string[] {
  return headers.map((header) => {
    const firstSemicolon = header.indexOf(";");
    if (firstSemicolon === -1) return header;
    const pair = header.slice(0, firstSemicolon);
    const name = pair.split("=", 1)[0].trim();
    if (!name) return header;

    // Only attributes after the cookie pair are inspected. Cookie values may
    // legitimately contain '=' and must be preserved verbatim.
    const attributes = header
      .slice(firstSemicolon + 1)
      .split(";")
      .map((attribute) => attribute.trim())
      .filter(Boolean);
    if (attributes.some((attribute) => !COOKIE_ATTRIBUTE.test(attribute))) {
      return header;
    }
    const present = new Set(
      attributes.map((attribute) => attribute.split("=", 1)[0].toLowerCase()),
    );
    for (const required of REQUIRED_COOKIE_ATTRIBUTES) {
      if (!present.has(required.split("=", 1)[0])) {
        attributes.push(mapAttribute(required));
      }
    }
    return `${pair}; ${attributes.join("; ")}`;
  });
}

const COOKIE_ATTRIBUTE =
  /^(?:[A-Za-z][A-Za-z0-9-]*|#[A-Za-z][A-Za-z0-9-]*)(?:=.*)?$/;

function mapAttribute(attribute: string): string {
  switch (attribute) {
    case "httponly":
      return "HttpOnly";
    case "secure":
      return "Secure";
    case "samesite=lax":
      return "SameSite=Lax";
    case "path=/":
      return "Path=/";
    default:
      return attribute;
  }
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
        ...(process.env.NODE_ENV === "production"
          ? [
              new (winston.transports as any).DailyRotateFile({
                dirname: "logs",
                filename: "api-%DATE%.log",
                datePattern: "YYYY-MM-DD",
                maxFiles: "14d",
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
  const logger = new Logger("Bootstrap");

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cookieParser());

  // Only a configured proxy hop may supply X-Forwarded-* (and therefore the
  // client IP used for rate limits). Express never trusts all peers here.
  const trustedProxies = parseTrustedProxies(process.env.TRUSTED_PROXIES);
  if (trustedProxies.length > 0) {
    app.set("trust proxy", trustedProxies);
  }

  // Wildcards are invalid when credentials are enabled: the browser rejects
  // an echoed Origin together with Access-Control-Allow-Credentials: true.
  // Canonicalize to scheme+host and fail fast on typos in production.
  const allowedOrigins = (() => {
    const raw = process.env.CORS_ORIGINS;
    if (process.env.NODE_ENV !== "production" && !raw) {
      return ["http://localhost:3000"];
    }
    return parseAllowedOrigins(raw);
  })();
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Idempotency-Key is sent by browser clients on every paid AI request;
    // omitting it from the preflight allow-list silently disables idempotency.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-timezone-offset",
      "Idempotency-Key",
    ],
    exposedHeaders: ["X-Request-ID"],
    maxAge: 600,
  });

  // Controllers set the refresh cookie themselves (auth.controller.ts). Add
  // any missing attributes at the response boundary so no path can emit a
  // session cookie without HttpOnly/Secure/SameSite/Path. Never rename or
  // rewrite cookie values.
  app.use((req: any, res: any, next: any) => {
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name: string, value: any) => {
      if (name.toLowerCase() === "set-cookie") {
        const values = Array.isArray(value) ? value : [value];
        return setHeader(name, hardenSetCookieHeaders(values.map(String)));
      }
      return setHeader(name, value);
    };
    next();
  });

  app.setGlobalPrefix("api");

  // Uploaded files are public assets (avatars, lesson audio). Keep the path
  // in sync with FilesService/UsersService, which write into CWD/uploads.
  // Prevent a browser from sniffing an uploaded file as executable HTML when
  // it is opened directly by URL.
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads/",
    setHeaders(res: any) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  });

  // API versioning: /api/v1/... for future backward compatibility
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // Request ID middleware: attaches a unique ID to every request for tracing.
  // Generate server-side by default; only a strictly shaped inbound ID is
  // propagated, so newlines/oversized values cannot forge log lines or audit
  // correlations. Everything else is replaced with a fresh UUID.
  const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
  const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
  app.use((req: any, res: any, next: any) => {
    const inbound = req.get?.("x-request-id") as string | undefined;
    const requestId =
      inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : uuidv4();
    const key = req.get?.("idempotency-key") as string | undefined;
    const idempotencyKey =
      key && IDEMPOTENCY_KEY_PATTERN.test(key) ? key : undefined;
    (req as any).requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    // Services that cannot take the header as a parameter (e.g. the cards
    // generation service) can still scope token debits to the client key.
    requestContextStorage.run(
      { requestId, idempotencyKey } as any,
      () => next(),
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
    process.env.NODE_ENV !== "production" ||
    process.env.SWAGGER_ENABLED === "true";
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle("LinguaAI API")
      .setDescription("Smart Language Learning Platform API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
    logger.log("Swagger UI mounted at /api/docs");
  }

  app.useWebSocketAdapter(new WsAdapter(app));

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

// Only start the server when this file is the process entry point; importing
// the pure SEC-05 helpers in unit tests must not bind a port.
if (require.main === module) {
  bootstrap();
}
