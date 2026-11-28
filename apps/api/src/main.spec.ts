// Security helpers live in main.ts; mock the Nest module graph so importing
// them does not boot the app or load native dependencies (bcrypt).
jest.mock('./app.module', () => ({ AppModule: class {} }));

import {
  parseAllowedOrigins,
  parseTrustedProxies,
  hardenSetCookieHeaders,
} from './main';

describe('SEC-05 bootstrap helpers', () => {
  describe('parseAllowedOrigins', () => {
    it('canonicalizes concrete origins to scheme+host', () => {
      expect(
        parseAllowedOrigins('https://app.example.com/, http://localhost:3000', {
          production: false,
        }),
      ).toEqual(['https://app.example.com', 'http://localhost:3000']);
    });

    it('rejects wildcards, paths, query strings, userinfo and non-http schemes', () => {
      for (const raw of [
        '*',
        'https://*.example.com',
        'https://app.example.com/callback',
        'https://app.example.com?x=1',
        'https://user:pass@app.example.com',
        'ftp://app.example.com',
      ]) {
        expect(() => parseAllowedOrigins(raw, { production: false })).toThrow(
          /invalid origin/i,
        );
      }
    });

    it('rejects plain HTTP in production unless explicitly opted in', () => {
      expect(() =>
        parseAllowedOrigins('http://app.example.com', { production: true }),
      ).toThrow(/invalid origin/i);
      expect(
        parseAllowedOrigins('http://app.example.com', {
          production: true,
          allowInsecureHttp: true,
        }),
      ).toEqual(['http://app.example.com']);
    });

    it('requires at least one origin in production', () => {
      expect(() =>
        parseAllowedOrigins(undefined, { production: true }),
      ).toThrow(/at least one origin/i);
      expect(parseAllowedOrigins(undefined, { production: false })).toEqual([]);
    });

    it('deduplicates equivalent origins', () => {
      expect(
        parseAllowedOrigins(
          'https://app.example.com, https://app.example.com/',
          {
            production: true,
          },
        ),
      ).toEqual(['https://app.example.com']);
    });
  });

  describe('parseTrustedProxies', () => {
    it('returns an empty list when nothing is configured', () => {
      expect(parseTrustedProxies(undefined)).toEqual([]);
      expect(parseTrustedProxies('')).toEqual([]);
    });

    it('accepts exact IPs and CIDRs but never blanket trust', () => {
      expect(
        parseTrustedProxies('127.0.0.1, 10.0.0.0/8, ::1, 2001:db8::/32'),
      ).toEqual(['127.0.0.1', '10.0.0.0/8', '::1', '2001:db8::/32']);
      for (const raw of [
        'true',
        '*',
        'example.com',
        '10.0.0.0/33',
        '::1/129',
      ]) {
        expect(() => parseTrustedProxies(raw)).toThrow(/invalid entry/i);
      }
    });
  });

  describe('hardenSetCookieHeaders', () => {
    it('adds missing attributes without changing the cookie name or value', () => {
      expect(
        hardenSetCookieHeaders(['refreshToken=abc.def%3D; Max-Age=604800']),
      ).toEqual([
        'refreshToken=abc.def%3D; Max-Age=604800; HttpOnly; Secure; SameSite=Lax; Path=/',
      ]);
    });

    it('preserves existing security attributes (including SameSite=None)', () => {
      expect(
        hardenSetCookieHeaders([
          'refreshToken=abc; HttpOnly; Secure; SameSite=None; Path=/; Domain=example.com',
        ]),
      ).toEqual([
        'refreshToken=abc; HttpOnly; Secure; SameSite=None; Path=/; Domain=example.com',
      ]);
    });

    it('leaves malformed headers untouched', () => {
      expect(hardenSetCookieHeaders(['not-a-cookie'])).toEqual([
        'not-a-cookie',
      ]);
    });
  });
});
