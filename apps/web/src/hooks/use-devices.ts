import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface Device {
  id: string;
  deviceId: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  ipAddress?: string;
  trusted: boolean;
  active: boolean;
  lastActiveAt?: string;
  createdAt: string;
}

export interface ActiveSessionsResponse {
  activeCount: number;
  devices: Device[];
}

export function useDevices() {
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery<ActiveSessionsResponse>({
    queryKey: ["devices", "sessions"],
    queryFn: async () => {
      const response = await apiClient.get<ActiveSessionsResponse>("/devices/sessions");
      return response.data;
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ deviceId, newName }: { deviceId: string; newName: string }) => {
      const response = await apiClient.put(`/devices/${deviceId}/name`, { newName });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", "sessions"] });
    },
  });

  const trustMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await apiClient.post(`/devices/${deviceId}/trust`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", "sessions"] });
    },
  });

  const untrustMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await apiClient.delete(`/devices/${deviceId}/trust`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", "sessions"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await apiClient.delete(`/devices/${deviceId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", "sessions"] });
    },
  });

  const removeOthersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.delete("/devices/others");
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices", "sessions"] });
    },
  });

  return {
    sessions: sessionsQuery.data,
    isLoading: sessionsQuery.isLoading,
    error: sessionsQuery.error,
    refetch: sessionsQuery.refetch,
    renameDevice: renameMutation.mutateAsync,
    isRenaming: renameMutation.isPending,
    trustDevice: trustMutation.mutateAsync,
    isTrusting: trustMutation.isPending,
    untrustDevice: untrustMutation.mutateAsync,
    isUntrusting: untrustMutation.isPending,
    removeDevice: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    removeOthers: removeOthersMutation.mutateAsync,
    isRemovingOthers: removeOthersMutation.isPending,
  };
}
