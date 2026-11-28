import {
  AI_FEATURES,
  DEFAULT_KILL_SWITCH,
  KILL_SWITCH_ALL_KEY,
  KILL_SWITCH_FEATURES_KEY,
  isFeatureEnabled,
  parseKillSwitchConfig,
} from './kill-switch';

/**
 * Feature identifiers are the FastAPI guard's route families
 * (apps/ai-service/app/core/limits.py), not the Nest billing labels.
 * Env values are injected here; no test reads a real `.env` or process.env.
 */
describe('kill switch configuration defaults and overrides', () => {
  it('defaults to enabled globally and for all seven features', () => {
    const config = parseKillSwitchConfig({});

    expect(config.allEnabled).toBe(true);
    expect(config.disabledFeatures.size).toBe(0);
    expect(DEFAULT_KILL_SWITCH.allEnabled).toBe(true);
    expect(DEFAULT_KILL_SWITCH.disabledFeatures.size).toBe(0);
    expect(AI_FEATURES).toEqual([
      'chat',
      'content',
      'errors',
      'grammar',
      'nlp',
      'reading',
      'writing',
    ]);
    for (const feature of AI_FEATURES) {
      expect(isFeatureEnabled(config, feature)).toBe(true);
      expect(isFeatureEnabled(DEFAULT_KILL_SWITCH, feature)).toBe(true);
    }
  });

  it('disables only the named feature for a single-feature override', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_FEATURES_KEY]: 'chat',
    });

    expect(config.allEnabled).toBe(true);
    expect([...config.disabledFeatures]).toEqual(['chat']);
    expect(isFeatureEnabled(config, 'chat')).toBe(false);
    for (const feature of AI_FEATURES.filter((f) => f !== 'chat')) {
      expect(isFeatureEnabled(config, feature)).toBe(true);
    }
  });

  it('normalizes a comma-separated list with spaces and mixed case', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_FEATURES_KEY]: ' CHAT , Content,Grammar , writing ',
    });

    expect([...config.disabledFeatures].sort()).toEqual([
      'chat',
      'content',
      'grammar',
      'writing',
    ]);
    expect(isFeatureEnabled(config, 'chat')).toBe(false);
    expect(isFeatureEnabled(config, 'content')).toBe(false);
    expect(isFeatureEnabled(config, 'grammar')).toBe(false);
    expect(isFeatureEnabled(config, 'writing')).toBe(false);
    expect(isFeatureEnabled(config, 'reading')).toBe(true);
    expect(isFeatureEnabled(config, 'errors')).toBe(true);
    expect(isFeatureEnabled(config, 'nlp')).toBe(true);
  });

  it.each([undefined, '', '   ', ',,,'])(
    'keeps defaults for blank or malformed override %p',
    (value) => {
      const config = parseKillSwitchConfig({
        [KILL_SWITCH_FEATURES_KEY]: value,
      });

      expect(config.allEnabled).toBe(true);
      expect(config.disabledFeatures.size).toBe(0);
    },
  );

  it.each(['false', '0', 'no', 'off', 'yes please', 'maybe', ''])(
    'keeps features enabled for malformed global value %p',
    (value) => {
      const config = parseKillSwitchConfig({
        [KILL_SWITCH_ALL_KEY]: value,
      });

      expect(config.allEnabled).toBe(true);
      for (const feature of AI_FEATURES) {
        expect(isFeatureEnabled(config, feature)).toBe(true);
      }
    },
  );

  it('ignores unknown feature names without disabling known ones', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_FEATURES_KEY]: 'unknown_feature, chatting, , chat',
    });

    expect([...config.disabledFeatures]).toEqual(['chat']);
    expect(isFeatureEnabled(config, 'unknown_feature')).toBe(true);
    expect(isFeatureEnabled(config, 'chat')).toBe(false);
    expect(isFeatureEnabled(config, 'content')).toBe(true);
  });

  it('global disable wins even when per-feature overrides are present', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_ALL_KEY]: 'true',
      [KILL_SWITCH_FEATURES_KEY]: 'chat, content',
    });

    expect(config.allEnabled).toBe(false);
    for (const feature of AI_FEATURES) {
      expect(isFeatureEnabled(config, feature)).toBe(false);
    }
    expect(isFeatureEnabled(config, 'unknown_feature')).toBe(false);
  });

  it('treats duplicate and case-variant tokens as one disabled feature', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_FEATURES_KEY]: 'chat, CHAT, chat , Chat',
    });

    expect([...config.disabledFeatures]).toEqual(['chat']);
    expect(isFeatureEnabled(config, 'chat')).toBe(false);
    expect(isFeatureEnabled(config, 'content')).toBe(true);
  });

  it('accepts a ConfigService-shaped get(killSwitchKey) source', () => {
    const values: Record<string, string> = {
      [KILL_SWITCH_FEATURES_KEY]: ' READING ',
      [KILL_SWITCH_ALL_KEY]: 'ON',
    };
    const get = jest.fn((key: string) => values[key]);

    const config = parseKillSwitchConfig({ get });

    expect(get).toHaveBeenCalledWith(KILL_SWITCH_FEATURES_KEY);
    expect(get).toHaveBeenCalledWith(KILL_SWITCH_ALL_KEY);
    expect(config.allEnabled).toBe(false);
    expect(isFeatureEnabled(config, 'reading')).toBe(false);
    expect(isFeatureEnabled(config, 'chat')).toBe(false);
  });

  it('returns immutable config objects so parsing cannot mutate defaults', () => {
    const config = parseKillSwitchConfig({
      [KILL_SWITCH_FEATURES_KEY]: 'chat',
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.disabledFeatures)).toBe(true);
    expect(Object.isFrozen(DEFAULT_KILL_SWITCH)).toBe(true);
    expect(Object.isFrozen(DEFAULT_KILL_SWITCH.disabledFeatures)).toBe(true);
    expect([...DEFAULT_KILL_SWITCH.disabledFeatures]).toEqual([]);
  });
});
