import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Single source of truth for TanStack Query keys.
 *
 * Every private key starts with the "linguaai" namespace and the owner id
 * before any parameter. Invalidation helpers therefore never cross user
 * boundaries: a partial match on one user's prefix cannot match another
 * user's cache entry. Public CMS content uses `public` instead of a user id
 * (`undefined` would be ambiguous), so an anonymous viewer cannot alias a
 * signed-in user's cache.
 *
 * This module is deliberately pure and side-effect free: it must not import
 * the application's global QueryClient singleton. Helpers receive the client
 * (from `useQueryClient()` or a caller) as an explicit argument.
 */

const root = ["linguaai"] as const;
type RootKey = typeof root;
type Owner = string | undefined;

/** Append segments while keeping a literal, readonly tuple at the type level. */
function extend<const T extends readonly unknown[], const S extends readonly unknown[]>(
  prefix: T,
  ...segments: S
): readonly [...T, ...S] {
  return [...prefix, ...segments];
}

/** The owner slot is always present, even for anonymous callers. */
function privateRoot(owner: Owner): readonly ["linguaai", "user", string | undefined] {
  return extend(root, "user", owner);
}

function publicRoot(): readonly ["linguaai", "public"] {
  return extend(root, "public");
}

export const queryKeys = {
  all: root,

  /** All cache entries belonging to one authenticated user. */
  user: (userId: Owner) => privateRoot(userId),

  decks: {
    all: (userId: Owner) => extend(privateRoot(userId), "decks"),
    list: (userId: Owner, language?: string) =>
      extend(privateRoot(userId), "decks", "list", language),
    detail: (userId: Owner, deckId: string) =>
      extend(privateRoot(userId), "decks", "detail", deckId),
    cards: (userId: Owner, deckId: string) =>
      extend(privateRoot(userId), "decks", "cards", deckId),
  },

  retention: {
    all: (userId: Owner) => extend(privateRoot(userId), "retention"),
    dashboard: (userId: Owner) => extend(privateRoot(userId), "retention", "dashboard"),
  },

  cards: {
    all: (userId: Owner) => extend(privateRoot(userId), "cards"),
    detail: (userId: Owner, cardId: string) =>
      extend(privateRoot(userId), "cards", "detail", cardId),
  },

  learning: {
    all: (userId: Owner) => extend(privateRoot(userId), "learning"),
    progress: (userId: Owner) => extend(privateRoot(userId), "learning", "progress"),
    path: (userId: Owner) => extend(privateRoot(userId), "learning", "path"),
    preferences: (userId: Owner) => extend(privateRoot(userId), "learning", "preferences"),
    skillCompletion: (userId: Owner) =>
      extend(privateRoot(userId), "learning", "skill-completion"),
  },

  dashboard: {
    all: (userId: Owner) => extend(privateRoot(userId), "dashboard"),
    stats: (userId: Owner) => extend(privateRoot(userId), "dashboard", "stats"),
    goals: (userId: Owner) => extend(privateRoot(userId), "dashboard", "goals"),
  },

  tokens: {
    all: (userId: Owner) => extend(privateRoot(userId), "tokens"),
    balance: (userId: Owner) => extend(privateRoot(userId), "tokens", "balance"),
  },

  devices: {
    all: (userId: Owner) => extend(privateRoot(userId), "devices"),
    sessions: (userId: Owner) => extend(privateRoot(userId), "devices", "sessions"),
  },

  chat: {
    all: (userId: Owner) => extend(privateRoot(userId), "chat"),
    conversations: (userId: Owner) => extend(privateRoot(userId), "chat", "conversations"),
    conversation: (userId: Owner, convId: string) =>
      extend(privateRoot(userId), "chat", "conversation", convId),
    messages: (userId: Owner, convId: string) =>
      extend(privateRoot(userId), "chat", "conversation", convId, "messages"),
  },

  speaking: {
    all: (userId: Owner) => extend(privateRoot(userId), "speaking"),
    history: (userId: Owner) => extend(privateRoot(userId), "speaking", "history"),
    topics: (userId: Owner) => extend(privateRoot(userId), "speaking", "topics"),
  },

  vocabulary: {
    all: (userId: Owner) => extend(privateRoot(userId), "vocabulary"),
    packs: (userId: Owner) => extend(privateRoot(userId), "vocabulary", "packs"),
    difficultWords: (userId: Owner) => extend(privateRoot(userId), "vocabulary", "difficult"),
    speedReview: (userId: Owner) => extend(privateRoot(userId), "vocabulary", "speed-review"),
  },

  content: {
    /** Shared/public data: never contains a user id. */
    all: () => publicRoot(),
    grammarLessons: () => extend(publicRoot(), "grammar-lessons"),
    communicationScenarios: () => extend(publicRoot(), "communication-scenarios"),
    communicationScenario: (slug: string) =>
      extend(publicRoot(), "communication-scenarios", "detail", slug),
  },
} as const;

/** Narrow helper used by the invalidation helpers below. */
function invalidate(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  return queryClient.invalidateQueries({ queryKey });
}

function updateBalance(
  queryClient: QueryClient,
  userId: Owner,
  updater: (old: unknown) => unknown,
): void {
  queryClient.setQueryData(queryKeys.tokens.balance(userId), updater);
}

/**
 * Mutations that add/remove a deck must refresh both list variants and the
 * user's progress-derived data; the deck detail and its cards are refreshed
 * by `invalidateDeck` when the mutation targets a single deck.
 */
export function invalidateDecks(queryClient: QueryClient, userId: Owner): Promise<void> {
  return invalidate(queryClient, queryKeys.decks.all(userId));
}

export function invalidateDeck(
  queryClient: QueryClient,
  userId: Owner,
  deckId: string,
): Promise<void> {
  return invalidate(queryClient, queryKeys.decks.detail(userId, deckId));
}

export function invalidateDeckCards(
  queryClient: QueryClient,
  userId: Owner,
  deckId: string,
): Promise<void> {
  return invalidate(queryClient, queryKeys.decks.cards(userId, deckId));
}

export function invalidateRetention(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.retention.all(userId));
}

export function invalidateLearningProgress(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.learning.progress(userId));
}

export function invalidateLearningPath(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.learning.path(userId));
}

export function invalidateLearningPreferences(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.learning.preferences(userId));
}

export function invalidateDashboard(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.dashboard.all(userId));
}

export function invalidateBalance(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.tokens.balance(userId));
}

export function setBalance(
  queryClient: QueryClient,
  userId: Owner,
  updater: (old: unknown) => unknown,
): void {
  updateBalance(queryClient, userId, updater);
}

export function invalidateDevices(queryClient: QueryClient, userId: Owner): Promise<void> {
  return invalidate(queryClient, queryKeys.devices.sessions(userId));
}

export function invalidateConversations(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.chat.conversations(userId));
}

export function invalidateConversation(
  queryClient: QueryClient,
  userId: Owner,
  convId: string,
): Promise<void> {
  return invalidate(queryClient, queryKeys.chat.conversation(userId, convId));
}

export function invalidateChat(
  queryClient: QueryClient,
  userId: Owner,
  convId?: string,
): Promise<void> {
  if (convId) {
    return invalidate(queryClient, queryKeys.chat.conversation(userId, convId));
  }
  return invalidate(queryClient, queryKeys.chat.all(userId));
}

export function invalidateSpeakingHistory(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.speaking.history(userId));
}

export function invalidateVocabulary(
  queryClient: QueryClient,
  userId: Owner,
): Promise<void> {
  return invalidate(queryClient, queryKeys.vocabulary.all(userId));
}

/** Refresh every user-owned query touched by a completed learning activity. */
export function invalidateLearningActivity(
  queryClient: QueryClient,
  userId: Owner,
  deckId?: string,
): Promise<void> {
  const invalidations: Promise<void>[] = [
    invalidateLearningProgress(queryClient, userId),
    invalidateLearningPath(queryClient, userId),
    invalidateDashboard(queryClient, userId),
    invalidateRetention(queryClient, userId),
    invalidateDecks(queryClient, userId),
  ];
  if (deckId) {
    invalidations.push(invalidateDeck(queryClient, userId, deckId));
  }
  return Promise.all(invalidations).then(() => undefined);
}

/**
 * Drop one user's cache without touching any other user or public data.
 * `removeQueries({ queryKey })` uses prefix matching, so all keys sharing the
 * `["linguaai", "user", userId]` prefix are removed.
 */
export function clearUserQueries(queryClient: QueryClient, userId: Owner): void {
  queryClient.removeQueries({ queryKey: queryKeys.user(userId) });
}

/**
 * Full cache reset for logout or identity change. Unlike `clearUserQueries`
 * this also removes public entries (and any legacy keys outside the
 * namespace), which is what session teardown requires.
 */
export function clearAllQueries(queryClient: QueryClient): void {
  queryClient.clear();
}
