import { create } from 'zustand';
import apiClient from '@/lib/api-client';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
  streakCount: number;
  totalXp: number;
  dailyGoal?: number;
  preferredLanguage?: string;
  nativeLanguage?: string;
  targetLanguage?: string;
  twoFactorEnabled?: boolean;
  createdAt?: string;
}

export type LoginResult =
  | { mfaRequired: false }
  | { mfaRequired: true; mfaToken: string };

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, totpCode: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

let inMemoryAccessToken: string | null = null;
const AUTH_TIMESTAMP_KEY = 'auth_timestamp';

function writeAuthTimestamp(): void {
  try {
    localStorage.setItem(AUTH_TIMESTAMP_KEY, Date.now().toString());
  } catch { /* private browsing */ }
}

function clearAuthTimestamp(): void {
  try {
    localStorage.removeItem(AUTH_TIMESTAMP_KEY);
  } catch { /* private browsing */ }
}

// Keep in-sync tabs from rendering an authenticated UI after logout in
// another tab. The token still lives only in memory in each tab, but a
// removed timestamp is an explicit session-end signal every tab can observe.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== AUTH_TIMESTAMP_KEY || event.newValue !== null) return;
    inMemoryAccessToken = null;
    useAuthStore.setState({ user: null, isLoading: false });
  });
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email, password) => {
    const { data } = await apiClient.post('/auth/login', { email, password });
    const payload = data.data ?? data;

    // MFA challenge: the backend returns no accessToken/user. Do not commit a
    // session or a fake user; hand the mfaToken back to the caller so it can
    // present the OTP form and complete verification via verifyMfa().
    if (payload?.mfaRequired) {
      if (!payload.mfaToken) throw new Error('Missing MFA token in login response');
      return { mfaRequired: true, mfaToken: payload.mfaToken as string };
    }

    if (!payload?.accessToken) {
      throw new Error('Login response did not include an access token');
    }
    inMemoryAccessToken = payload.accessToken;
    writeAuthTimestamp();
    const u = payload.user ?? {};
    set({
      user: {
        ...u,
        displayName: u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
        avatarUrl: u.avatarUrl ?? u.profilePicture ?? null,
        streakCount: u.streakCount ?? 0,
        totalXp: u.totalXp ?? 0,
        role: (Array.isArray(u.roles) ? (u.roles[0] ?? 'user') : (u.role ?? 'user')).toLowerCase(),
      },
    });
    return { mfaRequired: false };
  },

  verifyMfa: async (mfaToken, totpCode) => {
    const { data } = await apiClient.post('/auth/verify-mfa', { mfaToken, totpCode });
    const payload = data.data ?? data;
    if (!payload?.accessToken) {
      throw new Error('MFA verification did not return an access token');
    }
    inMemoryAccessToken = payload.accessToken;
    writeAuthTimestamp();
    const u = payload.user ?? {};
    set({
      user: {
        ...u,
        displayName: u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
        avatarUrl: u.avatarUrl ?? u.profilePicture ?? null,
        streakCount: u.streakCount ?? 0,
        totalXp: u.totalXp ?? 0,
        role: (Array.isArray(u.roles) ? (u.roles[0] ?? 'user') : (u.role ?? 'user')).toLowerCase(),
      },
    });
  },

  register: async (email, password, displayName) => {
    const [firstName, ...rest] = displayName.trim().split(' ');
    const lastName = rest.join(' ') || undefined;
    await apiClient.post('/auth/register', { email, password, firstName, lastName });
  },

  logout: async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // ignore logout API failure
    }
    inMemoryAccessToken = null;
    clearAuthTimestamp();
    set({ user: null });
  },

  loadUser: async () => {
    try {
      // After a page refresh, inMemoryAccessToken is lost but the httpOnly
      // refreshToken cookie may still exist. Always attempt a refresh via the
      // same-origin proxy so the cookie is forwarded to the API.
      if (!inMemoryAccessToken) {
        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          if (res.ok) {
            const json = await res.json();
            const payload = json?.data ?? json;
            if (payload?.accessToken) {
              inMemoryAccessToken = payload.accessToken;
              writeAuthTimestamp();
            }
          }
        } catch {
          // network error — ignore, will fail on /users/me below
        }
      }
      if (!inMemoryAccessToken) {
        set({ user: null, isLoading: false });
        return;
      }
      const { data } = await apiClient.get('/users/me');
      const profile = data.data ?? data;
      const existingRole = useAuthStore.getState().user?.role;
      const profileRole = profile.roles || profile.role
        ? (Array.isArray(profile.roles) ? (profile.roles[0] ?? 'user') : (profile.role ?? 'user')).toLowerCase()
        : null;
      set({
        user: {
          ...profile,
          displayName: profile.fullName || `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.email,
          avatarUrl: profile.avatarUrl ?? null,
          streakCount: profile.streakCount ?? 0,
          totalXp: profile.totalXp ?? 0,
          role: profileRole || existingRole || 'user',
        },
        isLoading: false,
      });
    } catch {
      inMemoryAccessToken = null;
      clearAuthTimestamp();
      set({ user: null, isLoading: false });
    }
  },
}));
