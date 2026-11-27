import { Request } from 'express';
import { isIP } from 'net';

export interface RequestContext {
  ip: string;
  ua: string;
  device: string;
}

/** Normalize IPv4-mapped IPv6 addresses so entries can be compared directly. */
function normalizeIp(value: string): string {
  const trimmed = value.trim().replace(/^::ffff:/i, '');
  return isIP(trimmed) !== 0 ? trimmed : '';
}

function isInCidr(ip: string, network: string, bits: number): boolean {
  const isV6 = isIP(ip) === 6;
  if (isIP(network) !== (isV6 ? 6 : 4)) return false;

  if (isV6) {
    const ipBytes = expandIPv6(ip);
    const netBytes = expandIPv6(network);
    if (!ipBytes || !netBytes) return false;
    const fullBytes = Math.floor(bits / 8);
    const remainder = bits % 8;
    for (let i = 0; i < fullBytes; i++) {
      if (ipBytes[i] !== netBytes[i]) return false;
    }
    if (remainder) {
      const mask = 0xff << (8 - remainder);
      if ((ipBytes[fullBytes] & mask) !== (netBytes[fullBytes] & mask)) return false;
    }
    return true;
  }

  const toInt = (address: string) =>
    address.split('.').reduce((acc, part) => (acc << 8) | Number(part), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
}

function expandIPv6(address: string): Uint8Array | null {
  const parts = address.split('::');
  const leftGroups = parts[0] ? parts[0].split(':') : [];
  const rightGroups = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (parts.length > 1 ? missing < 0 : leftGroups.length + rightGroups.length !== 8) {
    return null;
  }
  const groups = [...leftGroups, ...Array(Math.max(0, missing)).fill('0'), ...rightGroups];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = parseInt(groups[i], 16);
    if (!Number.isInteger(value)) return null;
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function isTrustedProxy(ip: string, trustedProxies: string[]): boolean {
  if (!ip || trustedProxies.length === 0) return false;
  return trustedProxies.some((entry) => {
    if (entry === ip) return true;
    if (!entry.includes('/')) return false;
    const [network, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    if (!isIP(network) || !Number.isInteger(bits)) return false;
    return isInCidr(ip, network, bits);
  });
}

/**
 * Resolve the client IP without trusting client-supplied X-Forwarded-For data.
 *
 * The header is only meaningful when the immediate peer is a proxy the
 * operator explicitly trusts via TRUSTED_PROXY_IPS (comma-separated IPs /
 * CIDRs). Even then, only the first untrusted hop from the right is used, so
 * entries prepended by the client cannot choose a different rate-limit bucket.
 * With no trusted proxy configured, the socket address is authoritative.
 */
function extractClientIp(req: Request): string {
  const socketIp = normalizeIp(req.socket?.remoteAddress ?? '') || req.ip || 'unknown';
  const trustedProxies = (process.env.TRUSTED_PROXY_IPS || process.env.TRUST_PROXY_IPS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!isTrustedProxy(socketIp, trustedProxies)) return socketIp;

  const forwarded = req.headers['x-forwarded-for'];
  if (!forwarded) return socketIp;

  const hops = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
    .split(',')
    .map((value) => normalizeIp(value))
    .filter((ip): ip is string => ip !== '');

  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i], trustedProxies)) return hops[i];
  }
  return socketIp;
}

export function extractRequestContext(req: Request): RequestContext {
  const ip = extractClientIp(req);
  const ua = (req.headers['user-agent'] as string) ?? '';
  return { ip, ua, device: parseDeviceInfo(ua) };
}

export function parseDeviceInfo(ua: string): string {
  if (!ua) return 'Unknown';
  if (/Mobile|Android(?!.*EdgA)/i.test(ua)) return 'Mobile';
  if (/Tablet|iPad/i.test(ua)) return 'Tablet';
  if (/Edg\//i.test(ua)) return 'Desktop / Edge';
  if (/Chrome/i.test(ua)) return 'Desktop / Chrome';
  if (/Firefox/i.test(ua)) return 'Desktop / Firefox';
  if (/Safari/i.test(ua)) return 'Desktop / Safari';
  return 'Desktop / Other';
}
