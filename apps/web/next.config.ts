import type { NextConfig } from 'next';
import path from 'path';

const isProd = process.env.NODE_ENV === 'production';

function resolveApiOrigins(): { http: string; ws: string } {
  try {
    const o = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').origin;
    const ws = o.replace(/^https/, 'wss').replace(/^http/, 'ws');
    return { http: o, ws };
  } catch {
    return { http: 'http://localhost:3001', ws: 'ws://localhost:3001' };
  }
}

const apiOrigins = resolveApiOrigins();

// In dev, Next.js requires `unsafe-eval` for fast refresh / React DevTools.
// In production we drop it to harden against XSS.
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${apiOrigins.http} https://api.dictionaryapi.dev https://res.cloudinary.com https://*.amazonaws.com`,
      `media-src 'self' ${apiOrigins.http} blob: data:`,
      "font-src 'self'",
      `connect-src 'self' ${apiOrigins.http} ${apiOrigins.ws} https://api.dictionaryapi.dev`,
      "frame-src 'self' https://www.youtube.com https://youtube.com https://*.youtube.com https://*.youtube-nocookie.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // 'standalone' output is enabled only for production Docker builds via the
  // BUILD_STANDALONE env, because it can interfere with the dev server
  // hydration (Next.js 15 + React 19).
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  transpilePackages: ['@linguaai/shared'],
  // Pin tracing root to this app to silence Next's "multiple lockfiles" warning
  // when a stray lockfile lives outside the workspace.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    middlewareClientMaxBodySize: '50mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: '*.amazonaws.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
