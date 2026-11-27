import { create } from "zustand";
import apiClient from "@/lib/api-client";

/* ────────────────────────────────────────────────────
 * Token costs for each AI feature (tokens consumed per use)
 * ──────────────────────────────────────────────────── */
export const TOKEN_COSTS = {
  ai_chat: 5, // per message
  writing_feedback: 10, // per submission
  reading_generate: 8, // per passage generated
  grammar_explain: 5, // per explanation
  listening_generate: 8, // per listening passage
  quiz_generate: 6, // per quiz generated
  translation_ai: 3, // per translation check
  speaking_feedback: 10, // per pronunciation analysis
  learning_path: 5, // per learning path generation
  cards_generate: 10,
} as const;

export type AIFeature = keyof typeof TOKEN_COSTS;

export const TOKEN_FEATURE_LABELS: Record<AIFeature, string> = {
  ai_chat: "Chat AI",
  writing_feedback: "Đánh giá bài viết",
  reading_generate: "Tạo bài đọc",
  grammar_explain: "Giải thích ngữ pháp",
  listening_generate: "Tạo bài nghe",
  quiz_generate: "Tạo bài quiz",
  translation_ai: "Kiểm tra dịch thuật",
  speaking_feedback: "Đánh giá phát âm",
  learning_path: "Lộ trình học tập",
  cards_generate: "Tạo bộ thẻ từ vựng",
};

/* ────────────────────────────────────────────────────
 * Token packages for purchase
 * ──────────────────────────────────────────────────── */
export interface TokenPackage {
  id: string;
  name: string;
  tokens: number;
  price: number; // USD
  priceVi: number; // VND (thousands)
  bonus: number; // bonus percentage
  popular?: boolean;
  bestValue?: boolean;
}

export const TOKEN_PACKAGES: TokenPackage[] = [
  {
    id: "starter",
    name: "Starter",
    tokens: 100,
    price: 0.99,
    priceVi: 25,
    bonus: 0,
  },
  {
    id: "basic",
    name: "Basic",
    tokens: 500,
    price: 3.99,
    priceVi: 99,
    bonus: 10,
    popular: true,
  },
  {
    id: "plus",
    name: "Plus",
    tokens: 1200,
    price: 7.99,
    priceVi: 199,
    bonus: 20,
  },
  {
    id: "pro",
    name: "Pro",
    tokens: 3000,
    price: 14.99,
    priceVi: 369,
    bonus: 30,
    bestValue: true,
  },
];

/* ────────────────────────────────────────────────────
 * Token usage history entry
 * ──────────────────────────────────────────────────── */
export interface TokenUsage {
  id: string;
  feature: AIFeature;
  cost: number;
  createdAt: string;
}

export interface TokenTransaction {
  id: string;
  user_id?: string;
  userId?: string;
  amount: number;
  type: string;
  feature: string;
  balance_after?: number;
  balanceAfter?: number;
  created_at?: string;
  createdAt?: string;
}

/* ────────────────────────────────────────────────────
 * Zustand store
 * ──────────────────────────────────────────────────── */
interface TokenState {
  balance: number;
  todayUsed: number;
  isLoading: boolean;
  history: TokenUsage[];
  transactions: TokenTransaction[];

  loadBalance: () => Promise<void>;
  consumeTokens: (feature: AIFeature) => Promise<boolean>;
  addTokens: (amount: number) => void;
  canAfford: (feature: AIFeature) => boolean;
  loadHistory: () => Promise<void>;
}

const FREE_DAILY_TOKENS = 30; // free users get 30 tokens/day

export const useTokenStore = create<TokenState>((set, get) => ({
  balance: FREE_DAILY_TOKENS,
  todayUsed: 0,
  isLoading: false,
  history: [],
  transactions: [],

  loadBalance: async () => {
    set({ isLoading: true });
    try {
      const { data } = await apiClient.get("/tokens/balance");
      const payload = data.data ?? data;
      set({
        balance: payload.balance ?? 0,
        todayUsed: payload.todayUsed ?? 0,
        isLoading: false,
      });
    } catch {
      // Server unavailable — keep last known balance
      set({ isLoading: false });
    }
  },

  consumeTokens: async (feature: AIFeature) => {
    const cost = TOKEN_COSTS[feature];

    // Call backend — server is the ONLY source of truth.
    // NO optimistic fallback to prevent client-side balance manipulation.
    try {
      const { data } = await apiClient.post("/tokens/consume", {
        feature,
        cost,
      });
      const payload = data.data ?? data;
      const newBalance = payload.balance;
      const newTodayUsed = get().todayUsed + cost;

      set({ balance: newBalance, todayUsed: newTodayUsed });

      const entry: TokenUsage = {
        id: crypto.randomUUID(),
        feature,
        cost,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ history: [entry, ...state.history].slice(0, 50) }));

      // Reload transactions history
      get().loadHistory().catch(() => {});

      return true;
    } catch (err) {
      const error = err as { response?: { status?: number }; message?: string };
      // 400 = insufficient balance (expected rejection)
      if (error?.response?.status === 400) return false;

      // Any other error (network, 5xx) = hard fail.
      // Do NOT allow optimistic consumption — that would be a security hole.
      // The user must have connectivity to use paid features.
      console.error(`Token consumption failed for ${feature}:`, error.message);
      return false;
    }
  },

  addTokens: async (amount: number) => {
    try {
      const { data } = await apiClient.post("/tokens/purchase", { amount });
      const payload = data.data ?? data;
      set({ balance: payload.balance });
      
      // Reload transactions history
      get().loadHistory().catch(() => {});
    } catch {
      // Server unavailable — balance unchanged
    }
  },

  canAfford: (feature: AIFeature) => {
    return get().balance >= TOKEN_COSTS[feature];
  },

  loadHistory: async () => {
    try {
      const { data } = await apiClient.get("/tokens/history");
      set({ transactions: data || [] });
    } catch {
      // silently handle
    }
  },
}));
