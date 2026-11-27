import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

interface BalanceResponse {
  balance: number;
}

export function useBalance() {
  const queryClient = useQueryClient();

  const balanceQuery = useQuery<BalanceResponse>({
    queryKey: ["token-balance"],
    queryFn: async () => {
      const response = await apiClient.get<BalanceResponse>("/tokens/balance");
      return response.data;
    },
  });

interface ConsumeResponse {
  remaining?: number;
  balance?: number;
}

  const consumeMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await apiClient.post<ConsumeResponse>("/tokens/consume", { amount });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData<BalanceResponse>(["token-balance"], (old) => {
        if (!old) return old;
        const newBalance = typeof data?.remaining === 'number' 
          ? data.remaining 
          : (typeof data?.balance === 'number' ? data.balance : old.balance);
        return {
          ...old,
          balance: newBalance
        };
      });
    },
  });

  return {
    balance: balanceQuery.data?.balance ?? 0,
    isLoading: balanceQuery.isLoading,
    error: balanceQuery.error,
    refetch: balanceQuery.refetch,
    consume: consumeMutation.mutateAsync,
    isConsuming: consumeMutation.isPending,
  };
}
