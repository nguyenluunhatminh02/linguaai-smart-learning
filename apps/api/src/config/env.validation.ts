import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  
  // Database — DATABASE_URL is the source of truth (PaaS providers usually only inject this).
  // Individual host/user/password fields are optional fallbacks for local dev.
  DATABASE_HOST: Joi.string().optional(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().optional(),
  DATABASE_PASSWORD: Joi.string().optional(),
  DATABASE_NAME: Joi.string().optional(),
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  REDIS_URL: Joi.string().optional(),

  // JWT
  JWT_SECRET: Joi.string().required().min(32),
  JWT_REFRESH_SECRET: Joi.string().required().min(32),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),

  // MFA
  MFA_ENCRYPTION_KEY: Joi.string().optional().min(16),

  // Groq
  GROQ_API_KEY: Joi.string().allow(''),
  GROQ_MODEL: Joi.string().default('llama-3.3-70b-versatile'),

  // AI Service
  AI_SERVICE_URL: Joi.string().default('http://localhost:8000'),
  // Comma-separated list of allowed keys. REQUIRED in every environment:
  // AiClientService omits the X-API-Key header entirely when this is empty,
  // which would leave the backend-to-AI-service channel unauthenticated.
  // Generate with: openssl rand -hex 32
  AI_SERVICE_API_KEYS: Joi.string().trim().min(16).required(),

  // Swagger toggle for production
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').optional(),

  // App
  API_PORT: Joi.number().default(3001),
  FRONTEND_URL: Joi.string().default('http://localhost:3000'),

  // Email
  EMAIL_HOST: Joi.string().allow(''),
  EMAIL_PORT: Joi.number().default(587),
  EMAIL_USER: Joi.string().allow(''),
  EMAIL_PASS: Joi.string().allow(''),
  EMAIL_FROM: Joi.string().allow(''),

  // CORS — REQUIRED in production to prevent unauthorized cross-origin requests
  CORS_ORIGINS: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().required().min(1).error(new Error('CORS_ORIGINS is required in production')),
      otherwise: Joi.string().allow(''),
    }),
})
.options({ stripUnknown: true });
