"use client";

import { useEffect, useRef } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/lib/query-client";
import { clearAllQueries } from "@/lib/query-keys";
import { useAuthStore } from "@/stores/auth-store";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id);
  const previousUserIdRef = useRef(userId);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;

    // Clear all queries when an authenticated session ends or switches identity.
    // On mount with no user there is nothing to tear down, so we skip the first
    // render to avoid clearing cache during initial hydration.
    // Note: This clears both user-scoped and public queries because many hooks
    // use legacy query keys without user prefixes. This is an acceptable tradeoff
    // to ensure no user data leaks after logout.
    if (previousUserId && previousUserId !== userId) {
      clearAllQueries(queryClient);
    }

    previousUserIdRef.current = userId;
  }, [userId]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
