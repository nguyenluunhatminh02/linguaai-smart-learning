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
import { requestContextStorage } from "./common/utils/request-context";
import { AppModule } from "./app.module";

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

  let allowedOrigins: string | string[];
  // Wildcards are invalid when credentials are enabled: the browser rejects
  // an echoed Origin together with Access-Control-Allow-Credentials: true.
  // Accept only concrete http(s) origins and fail fast on typos in production.
  const isValidOrigin = (value: string): boolean => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname.length > 0 &&
        !/[,\s*]/.test(value)
      );
    } catch {
      return false;
    }
  };
  const parseOrigins = (raw: string) => {
    const origins = raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const invalid = origins.filter((o) => !isValidOrigin(o));
    if (invalid.length > 0) {
      throw new Error(
        `CORS_ORIGINS contains invalid origin(s): ${invalid.join(", ")}`,
      );
    }
    return origins;
  };
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CORS_ORIGINS)
      throw new Error("CORS_ORIGINS must be defined in production");
    const origins = parseOrigins(process.env.CORS_ORIGINS);
    if (origins.length === 0) {
      throw new Error(
        "CORS_ORIGINS must contain at least one origin in production",
      );
    }
    allowedOrigins = origins;
  } else {
    const origins = process.env.CORS_ORIGINS
      ? parseOrigins(process.env.CORS_ORIGINS)
      : [];
    allowedOrigins = origins.length > 0 ? origins : ["http://localhost:3000"];
  }
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

bootstrap();
