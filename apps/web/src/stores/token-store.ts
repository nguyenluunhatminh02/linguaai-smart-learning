import { create } from "zustand";
import apiClient from "@/lib/api-client";

/* ────────────────────────────────────────────────────
 * Display-only cost labels.
 *
 * These values are NOT a billing source of truth. The server pricing catalog
 * (TokensService.getPricingCatalog) owns prices and the authoritative balance.
 * This copy exists only for UI labels until the read-only catalog is consumed
 * directly; it must never be used for debit arithmetic, authorization, or to
 * construct client-side ledger entries.
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
 * Token packages for display only. Purchases are server-owned.
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
 * Read models. Only server ledger rows are stored in `transactions`.
 * `history` is retained as an empty, legacy display field; the client never
 * synthesizes entries for it.
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

/** Accept only usable, server-supplied amounts; never default or guess. */
function isServerAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/* ────────────────────────────────────────────────────
 * Zustand store: a read model of server state only.
 * ──────────────────────────────────────────────────── */
interface TokenState {
  balance: number;
  todayUsed: number;
  isLoading: boolean;
  history: TokenUsage[];
  transactions: TokenTransaction[];

  /** Adopt the balance returned by GET /tokens/balance. */
  loadBalance: () => Promise<void>;
  /** Adopt only server ledger rows from GET /tokens/history. */
  loadHistory: () => Promise<void>;
  /** Adopt an authoritative balance carried by a server operation result. */
  syncBalance: (balance: unknown, todayUsed?: unknown) => void;
  /** Drop all cached token state without performing any request. */
  clear: () => void;
  /** Display hint only — the server enforces quota. */
  canAfford: (feature: AIFeature) => boolean;
}

const EMPTY_STATE = {
  balance: 0,
  todayUsed: 0,
  isLoading: false,
  history: [] as TokenUsage[],
  transactions: [] as TokenTransaction[],
};

export const useTokenStore = create<TokenState>((set, get) => ({
  // Unknown until the server says otherwise: 0 is an empty placeholder, not
  // a claimed free allowance.
  ...EMPTY_STATE,

  loadBalance: async () => {
    set({ isLoading: true });
    try {
      const { data } = await apiClient.get("/tokens/balance");
      // apiClient unwraps `data.data` and camelizes keys; the fallback keeps
      // compatibility with wrapped/mocked payloads.
      const payload = (data?.data ?? data) as Record<string, unknown> | null | undefined;
      const patch: Partial<TokenState> = {};

      if (isServerAmount(payload?.balance)) patch.balance = payload.balance;
      if (isServerAmount(payload?.todayUsed)) patch.todayUsed = payload.todayUsed;
      if (Object.keys(patch).length > 0) set(patch);
      // Missing/invalid values are ignored; no default is invented.
    } catch {
      // Server unavailable: keep the last known server-reported balance.
    } finally {
      set({ isLoading: false });
    }
  },

  loadHistory: async () => {
    try {
      const { data } = await apiClient.get("/tokens/history");
      const payload = (data?.data ?? data) as
        | TokenTransaction[]
        | { transactions?: TokenTransaction[] }
        | null
        | undefined;
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.transactions)
          ? payload.transactions
          : null;
      if (rows) set({ transactions: rows });
    } catch {
      // Keep the last server-reported history.
    }
  },

  syncBalance: (balance, todayUsed) => {
    const patch: Partial<TokenState> = {};
    if (isServerAmount(balance)) patch.balance = balance;
    if (todayUsed !== undefined && isServerAmount(todayUsed)) patch.todayUsed = todayUsed;
    if (Object.keys(patch).length > 0) set(patch);
  },

  clear: () => {
    set({ ...EMPTY_STATE, history: [], transactions: [] });
  },

  canAfford: (feature: AIFeature) => {
    // Display hint for cost labels only. The server is authoritative and may
    // reject the operation for quota, reservation, or policy reasons.
    return get().balance >= TOKEN_COSTS[feature];
  },
}));
