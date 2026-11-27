import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface CardItem {
  id: string;
  frontText?: string;
  backText?: string;
  front?: string;
  back?: string;
  ipaPronunciation?: string;
  exampleSentence?: string;
  createdAt: string;
}

export interface Deck {
  id: string;
  title?: string;
  name?: string;
  description: string;
  cardCount: number;
}

export function useDeck(deckId: string) {
  return useQuery<Deck>({
    queryKey: ["deck", deckId],
    queryFn: async () => {
      const response = await apiClient.get<Deck>(`/decks/${deckId}`);
      return response.data;
    },
    enabled: !!deckId,
  });
}

export function useCards(deckId: string) {
  const queryClient = useQueryClient();

  const cardsQuery = useQuery<CardItem[]>({
    queryKey: ["cards", deckId],
    queryFn: async () => {
      const response = await apiClient.get<CardItem[]>(`/decks/${deckId}/cards`);
      return response.data;
    },
    enabled: !!deckId,
  });

  const addCardMutation = useMutation({
    mutationFn: async (data: { frontText: string; backText: string }) => {
      const response = await apiClient.post<CardItem>(`/decks/${deckId}/cards`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (cardId: string) => {
      const response = await apiClient.delete(`/decks/${deckId}/cards/${cardId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  const generateCardsMutation = useMutation({
    mutationFn: async (data: { text: string; language: string; count: number }) => {
      const response = await apiClient.post<{ cards: CardItem[]; generated: number }>(
        `/decks/${deckId}/cards/generate-from-text`,
        data
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", deckId] });
      queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
      queryClient.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  return {
    cards: cardsQuery.data ?? [],
    isLoading: cardsQuery.isLoading,
    error: cardsQuery.error,
    refetch: cardsQuery.refetch,
    addCard: addCardMutation.mutateAsync,
    isAdding: addCardMutation.isPending,
    deleteCard: deleteCardMutation.mutateAsync,
    isDeleting: deleteCardMutation.isPending,
    generateCards: generateCardsMutation.mutateAsync,
    isGenerating: generateCardsMutation.isPending,
  };
}
