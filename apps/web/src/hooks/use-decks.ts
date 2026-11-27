import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface Deck {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  isPublic: boolean;
  createdAt: string;
}

export interface RetentionCard {
  cardId: string;
  frontText: string;
  stability: number;
  difficulty: number;
  retrievabilityPct: number;
  isAtRisk: boolean;
  nextReviewDate: string;
  repetitions: number;
}

export interface DeckRetention {
  deckId: string;
  totalCards: number;
  atRiskCards: number;
  avgRetentionPct: number;
  worstCards: RetentionCard[];
}

export interface RetentionDashboard {
  totalTracked: number;
  atRiskTotal: number;
  globalAvgRetentionPct: number;
  decks: DeckRetention[];
  algorithm: string;
  generatedAt: string;
}

export function useDecks(language?: string) {
  const queryClient = useQueryClient();

  const decksQuery = useQuery<Deck[]>({
    queryKey: ["decks", language],
    queryFn: async () => {
      const url = language ? `/decks?language=${language}` : "/decks";
      const response = await apiClient.get<Deck[] | { items: Deck[] }>(url);
      const data = response.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
        return data.items;
      }
      return [];
    },
  });

  const createDeckMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string; language?: string }) => {
      const response = await apiClient.post("/decks", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  return {
    decks: decksQuery.data ?? [],
    isLoading: decksQuery.isLoading,
    error: decksQuery.error,
    refetch: decksQuery.refetch,
    createDeck: createDeckMutation.mutateAsync,
    isCreating: createDeckMutation.isPending,
  };
}

export function useRetentionDashboard() {
  return useQuery<RetentionDashboard>({
    queryKey: ["retention-dashboard"],
    queryFn: async () => {
      const response = await apiClient.get<RetentionDashboard>("/srs/retention-dashboard");
      return response.data;
    },
  });
}
