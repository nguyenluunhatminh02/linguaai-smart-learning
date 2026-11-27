"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

export type LearningLevel = "A1" | "A2";
export const studyMinuteOptions = [5, 10, 15] as const;
export type DailyStudyMinutes = typeof studyMinuteOptions[number];

export interface LearningPreferences {
  level: LearningLevel;
  dailyStudyMinutes: DailyStudyMinutes;
  dailyWordGoal: number;
  dailyReviewGoal: number;
  configured: boolean;
}

const endpoint = "/users/me/learning-preferences";
const preferencesKey = (userId?: string) => ["learning-preferences", userId];

export function useLearningPreferences() {
  const userId = useAuthStore((state) => state.user?.id);
  return useQuery({
    queryKey: preferencesKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => (await apiClient.get<LearningPreferences>(endpoint)).data,
  });
}

export function useSaveLearningPreferences() {
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (changes: Partial<Omit<LearningPreferences, "configured">>) =>
      (await apiClient.patch<LearningPreferences>(endpoint, changes)).data,
    onSuccess: (preferences) => {
      queryClient.setQueryData(preferencesKey(userId), preferences);
      void queryClient.invalidateQueries({ queryKey: ["next-learning-activity"] });
    },
  });
}
