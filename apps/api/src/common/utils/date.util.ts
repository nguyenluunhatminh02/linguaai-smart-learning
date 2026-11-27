export const DateUtil = {
  now(): Date {
    return new Date();
  },

  nowISO(): string {
    return new Date().toISOString();
  },

  addMs(ms: number, base: Date = new Date()): Date {
    return new Date(base.getTime() + ms);
  },

  addSeconds(seconds: number, base: Date = new Date()): Date {
    return new Date(base.getTime() + seconds * 1000);
  },

  addMinutes(minutes: number, base: Date = new Date()): Date {
    return new Date(base.getTime() + minutes * 60 * 1000);
  },

  addHours(hours: number, base: Date = new Date()): Date {
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
  },

  addDays(days: number, base: Date = new Date()): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  },

  subtractMs(ms: number, base: Date = new Date()): Date {
    return new Date(base.getTime() - ms);
  },

  subtractDays(days: number, base: Date = new Date()): Date {
    return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
  },

  isExpired(date: Date | string | null | undefined): boolean {
    if (!date) return true;
    return new Date(date) < new Date();
  },

  isBefore(date: Date | string, compareTo: Date | string): boolean {
    return new Date(date) < new Date(compareTo);
  },

  toDate(value: string | number | Date): Date {
    return new Date(value);
  },

  toISOString(value: string | number | Date): string {
    return new Date(value).toISOString();
  },

  currentYear(): number {
    return new Date().getFullYear();
  },

  /**
   * Parse a human-readable duration into milliseconds.
   *
   * Accepts a suffixed string (`'15m'`, `'7d'`, `'900s'`, `'1h'`, `'2w'`, `'500ms'`)
   * or a bare number. Bare numeric STRINGS are SECONDS (matching the old JWT
   * `expiresIn` semantics, e.g. `900` = 15 minutes); use an explicit `ms`
   * suffix for millisecond values (e.g. `'500ms'`). Numeric inputs from code
   * are kept as milliseconds so existing programmatic callers are unaffected.
   *
   * @param value      Duration string or number
   * @param fallbackMs Returned when value is missing or unparseable (optional).
   *                   When omitted, an invalid value throws.
   */
  parseDurationMs(
    value: string | number | null | undefined,
    fallbackMs?: number,
  ): number {
    if (value === null || value === undefined || value === "") {
      if (fallbackMs !== undefined) {
        console.warn(
          `parseDurationMs: missing duration; falling back to ${fallbackMs}ms`,
        );
        return fallbackMs;
      }
      throw new Error("parseDurationMs: a duration value is required");
    }
    // Numeric values supplied directly from code are already milliseconds.
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`parseDurationMs: invalid duration ${value}`);
      }
      return value;
    }

    const trimmed = value.trim();
    // Bare numeric STRING → seconds (legacy JWT expiresIn semantics).
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return Math.floor(parseFloat(trimmed) * 1000);
    }

    const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(trimmed);
    if (!match) {
      if (fallbackMs !== undefined) {
        console.warn(
          `parseDurationMs: invalid duration "${value}"; falling back to ${fallbackMs}ms`,
        );
        return fallbackMs;
      }
      throw new Error(`parseDurationMs: invalid duration "${value}"`);
    }

    const amount = parseFloat(match[1]);
    const unitMs: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };
    return Math.floor(amount * unitMs[match[2].toLowerCase()]);
  },
};
