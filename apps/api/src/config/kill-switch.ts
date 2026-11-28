import {
  Global,
  Injectable,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stable client-visible code carried by a disabled-feature response.
 *
 * The global exception filter currently allowlists its own `ApiErrorCode`
 * union, so a 503 raised here is rendered as `PROVIDER_UNAVAILABLE` until that
 * filter (out of scope for this slice) registers `FEATURE_DISABLED`. Keeping
 * the constant in one place lets that registration avoid repeating a literal.
 */
export const FEATURE_DISABLED_CODE = 'FEATURE_DISABLED';

/** Global off switch; overrides every per-feature value. */
export const KILL_SWITCH_ALL_KEY = 'AI_KILL_SWITCH_ALL';

/** Comma-separated list of features to disable. */
export const KILL_SWITCH_FEATURES_KEY = 'AI_FEATURE_KILL_SWITCH';

/**
 * Route-family identifiers shared with the FastAPI guard
 * (`apps/ai-service/app/core/limits.py`: `FEATURE_LIMITS` / `PATH_FEATURE_MAP`).
 * These are deliberately not the billing feature labels in AiClientService.
 */
export const AI_FEATURES = [
  'chat',
  'content',
  'errors',
  'grammar',
  'nlp',
  'reading',
  'writing',
] as const;

export type AIFeature = (typeof AI_FEATURES)[number];

export type KillSwitchConfig = Readonly<{
  allEnabled: boolean;
  disabledFeatures: ReadonlySet<AIFeature>;
}>;

const AI_FEATURE_SET: ReadonlySet<string> = new Set<string>(AI_FEATURES);

/** Frozen defaults; the disabled set is empty and cannot be mutated. */
export const DEFAULT_KILL_SWITCH: KillSwitchConfig = Object.freeze({
  allEnabled: true,
  disabledFeatures: Object.freeze(new Set<AIFeature>()),
});

/**
 * True only for an explicitly disabling string. Every other value (including
 * 'false', '0', blank and malformed input) leaves the guard on. Values are
 * trimmed and lowercased, but abbreviations are not guessed: a typo must never
 * silently switch off every feature.
 */
function isDisabled(value: string | undefined): boolean {
  return (
    typeof value === 'string' &&
    ['true', '1', 'yes', 'on', 'disabled'].includes(value.trim().toLowerCase())
  );
}

/** A ConfigService-shaped reader, so no unit test has to boot Nest. */
export interface KillSwitchEnvReader {
  get(key: string): string | undefined;
}

/** Either an injected env map or an injected reader; never process.env itself. */
export type KillSwitchEnvSource =
  | Readonly<Record<string, string | undefined>>
  | KillSwitchEnvReader;

function readKey(env: KillSwitchEnvSource, key: string): string | undefined {
  if ('get' in env && typeof env.get === 'function') {
    return env.get(key);
  }
  return (env as Readonly<Record<string, string | undefined>>)[key];
}

/**
 * Parse an injected env source. No process.env access and no ConfigModule
 * loading: callers choose the source, so tests never read a developer's .env.
 * Blank lists and unknown tokens are ignored; known tokens are trimmed and
 * lowercased so ' CHAT , Content ' behaves like 'chat,content'.
 */
export function parseKillSwitchConfig(
  env: KillSwitchEnvSource = {},
): KillSwitchConfig {
  const disabled = new Set<AIFeature>();
  const rawList = readKey(env, KILL_SWITCH_FEATURES_KEY);

  if (typeof rawList === 'string') {
    for (const token of rawList.split(',')) {
      const normalized = token.trim().toLowerCase();
      if (AI_FEATURE_SET.has(normalized)) {
        disabled.add(normalized as AIFeature);
      }
    }
  }

  return Object.freeze({
    allEnabled: !isDisabled(readKey(env, KILL_SWITCH_ALL_KEY)),
    disabledFeatures: Object.freeze(disabled),
  });
}

/** A global kill wins over every per-feature value; unknown names stay on. */
export function isFeatureEnabled(
  config: KillSwitchConfig,
  feature: string,
): boolean {
  if (!config.allEnabled) {
    return false;
  }
  const normalized = feature.trim().toLowerCase();
  return !AI_FEATURE_SET.has(normalized) || !config.disabledFeatures.has(normalized as AIFeature);
}

/**
 * Every flag is backed by a validated `FEATURE_<NAME>` environment variable.
 * The seven AI_OPERATION_COSTS features are listed first so the shared prefix
 * can be derived mechanically; `token_purchase` (BILL-01) and
 * `writing_error_analysis` are independent paid paths.
 */
export const AI_OPERATION_FEATURE_FLAGS = [
  'ai_chat',
  'writing_feedback',
  'reading_generate',
  'grammar_explain',
  'listening_generate',
  'quiz_generate',
  'translation_ai',
] as const;

export const FEATURE_FLAGS = [
  ...AI_OPERATION_FEATURE_FLAGS,
  'speaking_feedback',
  'learning_path',
  'cards_generate',
  'token_purchase',
  'writing_error_analysis',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Exhaustive lookup; no dynamic construction from untrusted input. */
const FEATURE_FLAG_SET: ReadonlySet<string> = new Set<string>(FEATURE_FLAGS);

/** `FEATURE_AI_CHAT` for `ai_chat`; uppercase only, so env keys stay stable. */
export function featureEnvKey(feature: FeatureFlag): string {
  return `FEATURE_${feature.toUpperCase()}`;
}

/**
 * Narrow to flags this module knows. `speaking_feedback`, `learning_path` and
 * `cards_generate` are present in TokensService.COSTS/AI_OPERATION_COSTS and
 * therefore also have flags here.
 */
export function isFeatureFlag(value: string): value is FeatureFlag {
  return FEATURE_FLAG_SET.has(value);
}

@Injectable()
export class KillSwitchService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Only the exact validated string 'false' disables a feature. A missing
   * value keeps it on, matching the env schema's default 'true'; unexpected
   * values are rejected by Joi before they reach this service. Unknown
   * feature names are rejected rather than silently treated as enabled.
   */
  isEnabled(feature: FeatureFlag): boolean {
    if (!isFeatureFlag(feature)) {
      throw new Error(`Unknown feature flag: ${feature}`);
    }
    return this.config.get<string>(featureEnvKey(feature)) !== 'false';
  }

  /** Use as the first statement of a paid handler, before any debit or call. */
  assertEnabled(feature: FeatureFlag): void {
    if (!this.isEnabled(feature)) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: FEATURE_DISABLED_CODE,
        message: `Feature ${feature} is temporarily unavailable.`,
      });
    }
  }
}

@Global()
@Module({
  providers: [KillSwitchService],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}
