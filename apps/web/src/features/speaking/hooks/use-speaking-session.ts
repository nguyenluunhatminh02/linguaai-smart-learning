'use client';

/**
 * TanStack Query server state for speaking sessions (roadmap FE-06).
 *
 * Only server-backed data lives in the query cache: paginated speaking history
 * and the derived token balance. Recording, WebSocket streaming, live scores
 * and transcripts are ephemeral React state owned by the speaker UI and must
 * never be written here (a stale cached transcript could leak to another user).
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

export interface SpeakingScores {
  overall: number;
  basis?: 'transcript';
  grammar: number;
  vocabulary: number;
}

export interface SpeakingHistoryItem {
  id: string;
  topic: string | null;
  transcript: string;
  feedback: string;
  scores: SpeakingScores | null;
  language: string;
  level: string;
  durationSec: number;
  createdAt: string;
}

export interface SpeakingHistoryResponse {
  total: number;
  page: number;
  limit: number;
  items: SpeakingHistoryItem[];
}

export interface SpeakingTopic {
  topic: string;
  prompt: string;
  tips: string[];
  samplePhrases: string[];
  duration: number;
  difficulty: string;
}

export interface GenerateSpeakingTopicInput {
  level: string;
  category: string;
  language: string;
}

export interface GenerateSpeakingTopicResult {
  data: SpeakingTopic;
  operationId: string;
  balance?: unknown;
}

export const tokenBalanceKeys = {
  all: ['token-balance'] as const,
};

/** User-scoped keys: a history entry must never be visible to another user. */
export const speakingKeys = {
  all: ['speaking'] as const,
  history: (userId?: string) => [...speakingKeys.all, 'history', userId] as const,
  topics: () => [...speakingKeys.all, 'topics'] as const,
};

export const SPEAKING_HISTORY_PAGE_SIZE = 10;

/** Backend pagination is 1-based; infer the next page from the page we just fetched. */
function nextPageParam(response: SpeakingHistoryResponse): number | undefined {
  const current = Number.isFinite(response.page) && response.page > 0 ? response.page : 1;
  const total = Number.isFinite(response.total) ? response.total : 0;
  const fetched = response.items?.length ?? 0;
  if (fetched === 0) return undefined;
  if (total > 0 && current * response.limit >= total) return undefined;
  return current + 1;
}

export function useSpeakingHistory(
  userId?: string,
  page: number = 1,
  limit: number = SPEAKING_HISTORY_PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey: speakingKeys.history(userId),
    enabled: Boolean(userId),
    initialPageParam: page,
    queryFn: async ({ pageParam }) => {
      const response = await apiClient.get<SpeakingHistoryResponse>('/speaking/history', {
        params: { page: pageParam, limit },
      });
      return response.data;
    },
    getNextPageParam: nextPageParam,
  });
}

/**
 * Topic generation charges credits, so it is always a mutation: no query
 * caching and no automatic retries. Invalidate the balance only after a
 * terminal success (React Query does not retry mutations by default).
 */
export function useGenerateSpeakingTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ level, category, language }: GenerateSpeakingTopicInput) =>
      (
        await apiClient.post<GenerateSpeakingTopicResult>('/speaking/topic', {
          level,
          category,
          language,
        })
      ).data,
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tokenBalanceKeys.all });
    },
  });
}

/**
 * Call only when the speaking session reaches a terminal state (feedback_done
 * or a billing/processing error), never for interim status or SSE chunks.
 * Pass the active user id so another user's history is never refreshed.
 */
export function invalidateSpeakingSession(
  queryClient: QueryClient,
  userId?: string,
): void {
  void queryClient.invalidateQueries({ queryKey: tokenBalanceKeys.all });
  if (userId) {
    void queryClient.invalidateQueries({ queryKey: speakingKeys.history(userId) });
  }
}

/** Terminal-state helper for a mounted component. */
export function useInvalidateSpeakingSession() {
  const queryClient = useQueryClient();

  return (userId?: string) => invalidateSpeakingSession(queryClient, userId);
}

/** Exposed for callers that need to address all user-scoped history entries. */
export function getSpeakingHistoryKey(userId?: string): QueryKey {
  return speakingKeys.history(userId);
}
