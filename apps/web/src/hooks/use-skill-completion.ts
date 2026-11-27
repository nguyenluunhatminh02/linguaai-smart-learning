import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface SkillCompletion {
  activityType: 'reading' | 'listening';
  activityId: string;
  language: string;
  durationSeconds?: number;
}

export function useSkillCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (activity: SkillCompletion) => apiClient.post('/learning/progress', activity),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['next-learning-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}
