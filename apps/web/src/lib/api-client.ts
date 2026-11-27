import axios from "axios";
import { getAccessToken, setAccessToken } from "@/stores/auth-store";

function camelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([key, val]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camelizeKeys(val),
      ]),
    );
  }
  return obj;
}

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 60000,
  withCredentials: true,
});

let refreshPromise: Promise<void> | null = null;

/**
 * Refresh the access token via the same-origin proxy. Single-flight: concurrent
 * callers share one in-flight refresh. Returns the new access token (or null).
 * Exported so non-axios callers (e.g. the chat SSE stream) can reuse the same
 * refresh path instead of silently dropping the session on 401.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("refresh failed");
      const json = await res.json();
      const payload = json?.data ?? json;
      if (!payload?.accessToken) {
        // A 200 response without an access token is still a failed refresh.
        // Do not keep the old (expired) token in memory.
        setAccessToken(null);
        throw new Error("refresh response missing accessToken");
      }
      setAccessToken(payload.accessToken);
    })().finally(() => {
      refreshPromise = null;
    });
  }
  await refreshPromise;
  return getAccessToken();
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    // Never let a retry or a reused config carry a stale bearer token.
    delete config.headers.Authorization;
  }
  config.headers["x-timezone-offset"] = new Date().getTimezoneOffset().toString();
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (
      response.data !== null &&
      typeof response.data === "object" &&
      "success" in response.data &&
      "data" in response.data
    ) {
      response.data = response.data.data;
    }
    response.data = camelizeKeys(response.data);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const authEndpoint = /^\/auth\/(login|register|verify-email|resend-verification)(\?|$)/.test(
      originalRequest.url ?? '',
    );
    if (error.response?.status === 401 && !originalRequest._retry && !authEndpoint) {
      originalRequest._retry = true;
      try {
        const newToken = await refreshAccessToken();
        if (!newToken) throw new Error("refresh failed");
        // Force the request interceptor to attach the new token rather than
        // reusing whatever Authorization was on the original request.
        delete originalRequest.headers.Authorization;
        return apiClient(originalRequest);
      } catch {
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
export { apiClient };
