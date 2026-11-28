import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CreateOnboardingDto,
  ONBOARDING_GOALS,
  SELF_LEVELS,
} from './onboarding.dto';
import { PROFICIENCY_LANGUAGES } from './proficiency.dto';

describe('CreateOnboardingDto validation', () => {
  const validPayload = {
    targetLanguage: 'english',
    goal: 'conversation',
    selfLevel: 'elementary',
    dailyMinutes: 15,
  };

  it('accepts a fully valid payload with all required fields', () => {
    const dto = plainToInstance(CreateOnboardingDto, validPayload);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts all goal values', () => {
    for (const goal of ONBOARDING_GOALS) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        goal,
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts all self-level values', () => {
    for (const selfLevel of SELF_LEVELS) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        selfLevel,
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts all proficiency languages', () => {
    for (const targetLanguage of PROFICIENCY_LANGUAGES) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        targetLanguage,
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts boundary-valid dailyMinutes (5 and 180)', () => {
    for (const dailyMinutes of [5, 180]) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        dailyMinutes,
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts optional placementOptIn when provided as boolean', () => {
    for (const placementOptIn of [true, false]) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        placementOptIn,
      });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects missing required fields', () => {
    const dto = plainToInstance(CreateOnboardingDto, {});
    const errors = validateSync(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('targetLanguage');
    expect(properties).toContain('goal');
    expect(properties).toContain('selfLevel');
    expect(properties).toContain('dailyMinutes');
  });

  it('rejects unknown targetLanguage', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      targetLanguage: 'klingon',
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'targetLanguage')).toBe(true);
  });

  it('rejects unknown goal', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      goal: 'hobby',
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'goal')).toBe(true);
  });

  it('rejects unknown selfLevel', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      selfLevel: 'expert',
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'selfLevel')).toBe(true);
  });

  it('rejects dailyMinutes below minimum (0, 4)', () => {
    for (const dailyMinutes of [0, 4]) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        dailyMinutes,
      });
      const errors = validateSync(dto);
      expect(errors.some((e) => e.property === 'dailyMinutes')).toBe(true);
    }
  });

  it('rejects dailyMinutes above maximum (181)', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      dailyMinutes: 181,
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'dailyMinutes')).toBe(true);
  });

  it('rejects negative dailyMinutes', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      dailyMinutes: -1,
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'dailyMinutes')).toBe(true);
  });

  it('rejects non-integer dailyMinutes (1.5)', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      dailyMinutes: 1.5,
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'dailyMinutes')).toBe(true);
  });

  it('rejects numeric-string dailyMinutes when implicit conversion is disabled', () => {
    const dto = plainToInstance(
      CreateOnboardingDto,
      { ...validPayload, dailyMinutes: '30' },
      { enableImplicitConversion: false },
    );
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'dailyMinutes')).toBe(true);
  });

  it('rejects non-boolean placementOptIn', () => {
    for (const placementOptIn of ['yes', 1, {}, []]) {
      const dto = plainToInstance(CreateOnboardingDto, {
        ...validPayload,
        placementOptIn,
      });
      const errors = validateSync(dto);
      expect(errors.some((e) => e.property === 'placementOptIn')).toBe(true);
    }
  });

  it('rejects unknown extra keys when whitelist is enforced', () => {
    const dto = plainToInstance(CreateOnboardingDto, {
      ...validPayload,
      cefrEstimate: 'A2',
    });
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((e) => e.property === 'cefrEstimate')).toBe(true);
  });

  it('does not expose CEFR fields on the DTO instance', () => {
    const dto = plainToInstance(CreateOnboardingDto, validPayload);
    expect(dto).not.toHaveProperty('cefr');
    expect(dto).not.toHaveProperty('cefrEstimate');
    expect(dto).not.toHaveProperty('confidence');
    expect(dto).not.toHaveProperty('evidenceCount');
    expect(dto).not.toHaveProperty('score');
    expect(dto).not.toHaveProperty('total');
  });
});
