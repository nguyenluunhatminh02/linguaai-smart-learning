import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

export function useUpdateProfile() {
  const { loadUser } = useAuthStore();

  return useMutation({
    mutationFn: async (data: {
      firstName: string;
      lastName?: string;
      nativeLanguage?: string | null;
      targetLanguage?: string | null;
    }) => {
      const response = await apiClient.put("/users/me", data);
      return response.data;
    },
    onSuccess: async () => {
      await loadUser();
    },
  });
}
