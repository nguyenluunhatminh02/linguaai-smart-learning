/**
 * JWT Verification for Next.js API Routes
 *
 * Verifies JWT tokens and extracts user info + role for authorization.
 * This is the server-side counterpart to the backend's JwtAuthGuard.
 */

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
  type?: string;
  jti?: string;
  deviceId?: string;
  aud?: string | string[];
  iss?: string;
}

// Only ordinary access tokens may authorize CMS/API actions. Refresh and MFA
// tokens carry the same signing secret (and often the same roles) but must
// never grant access to protected endpoints.
const ACCESS_TOKEN_TYPES = new Set(["ACCESS", "access", "at", "+access"]);
const FORBIDDEN_TOKEN_TYPES = new Set([
  "REFRESH",
  "refresh",
  "rt",
  "MFA_PENDING",
  "mfa_pending",
]);

export interface VerifiedUser {
  id: string;
  email: string;
  roles: string[];
  isAdmin: boolean;
}

/**
 * Decode and verify JWT token
 *
 * @param token - JWT token string (without "Bearer " prefix)
 * @returns VerifiedUser object or null if verification fails
 */
export async function verifyJwt(token: string): Promise<VerifiedUser | null> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[JWT] JWT_SECRET not configured");
      return null;
    }

    // Split token into parts
    const parts = token.split(".");
    if (parts.length !== 3) {
      console.error("[JWT] Invalid token format");
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature using Web Crypto API (compatible with Edge Runtime & Node.js)
    const data = `${headerB64}.${payloadB64}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(data)
    );
    
    const bytes = new Uint8Array(signatureBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const expectedSignature = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    if (signatureB64 !== expectedSignature) {
      console.error("[JWT] Invalid signature");
      return null;
    }

    // Decode payload using Web APIs (compatible with Edge Runtime & Node.js)
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const binaryPayload = atob(base64);
    const payloadBytes = new Uint8Array(binaryPayload.length);
    for (let i = 0; i < binaryPayload.length; i++) {
      payloadBytes[i] = binaryPayload.charCodeAt(i);
    }
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as JwtPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) {
      console.error("[JWT] Token missing or expired exp:", payload.exp);
      return null;
    }

    // Reject refresh/MFA tokens even though they are signed with the same key.
    // Older access tokens without an explicit type remain valid unless their
    // deviceId marks them as refresh/MFA tokens.
    const declaredType = payload.type;
    if (declaredType && FORBIDDEN_TOKEN_TYPES.has(declaredType)) {
      console.error("[JWT] Rejected non-access token type:", declaredType);
      return null;
    }
    if (declaredType && !ACCESS_TOKEN_TYPES.has(declaredType)) {
      console.error("[JWT] Unknown token type:", declaredType);
      return null;
    }
    if (
      !declaredType &&
      typeof payload.deviceId === "string" &&
      payload.deviceId.startsWith("mfa:")
    ) {
      console.error("[JWT] Rejected MFA token without declared type");
      return null;
    }

    const roles = payload.roles || [];
    if (!Array.isArray(roles)) {
      console.error("[JWT] Invalid roles claim");
      return null;
    }
    if (!roles.every((role) => typeof role === "string")) {
      console.error("[JWT] Invalid roles claim");
      return null;
    }
    const isAdmin = roles.some(
      (role) =>
        role.toUpperCase() === "ADMIN" || role.toUpperCase() === "ROLE_ADMIN",
    );
    return {
      id: payload.sub,
      email: payload.email,
      roles,
      isAdmin,
    };
  } catch (error) {
    console.error(
      "[JWT] Verification failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}

/**
 * Extract and verify JWT from Authorization header
 *
 * @param authHeader - Authorization header value (e.g., "Bearer token...")
 * @returns VerifiedUser object or null if invalid/missing
 */
export async function verifyAuthHeader(
  authHeader: string | null,
): Promise<VerifiedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim(); // Remove "Bearer " prefix
  return verifyJwt(token);
}

/**
 * Check if user has admin role
 *
 * @param user - Verified user object
 * @returns true if user is admin
 */
export function isAdmin(user: VerifiedUser | null): boolean {
  return user?.isAdmin ?? false;
}

/**
 * Check if user has any of the required roles
 *
 * @param user - Verified user object
 * @param requiredRoles - Array of required role names
 * @returns true if user has at least one required role
 */
export function hasRole(
  user: VerifiedUser | null,
  requiredRoles: string[],
): boolean {
  if (!user) return false;

  const userRolesUpper = user.roles.map((r) => r.toUpperCase());
  return requiredRoles.some((role) =>
    userRolesUpper.includes(role.toUpperCase()),
  );
}
