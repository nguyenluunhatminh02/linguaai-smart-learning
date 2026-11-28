"use client";

/**
 * P0 BUG-03/BUG-04 fix — CHAT-03 frontend chat state.
 *
 * Stream parsing uses the shared chunk-safe parser in @/lib/sse-parser: EOF and
 * legacy `data: [DONE]` are incomplete, never a verified success. The deployed
 * backend still emits only legacy token events and has no operation/status
 * endpoint, so that path remains visibly incomplete and never invalidates
 * balance/messages or persists a fabricated reply client-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiClient, refreshAccessToken } from "@/lib/api-client";
import {
  parseSseStream,
  type SseEvent,
  type SseOutcome,
} from "@/lib/sse-parser";
import { getAccessToken } from "@/stores/auth-store";
import { Avatar } from "@/components/ui/avatar";
import {
  MessageSquare,
  Send,
  Plus,
  Bot,
  Sparkles,
  Mic,
  MicOff,
  Volume2,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { speakWord } from "@/lib/speech";
import { useLanguageStore } from "@/stores/language-store";
import { TokenCost } from "@/components/ui/token-cost";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  /** Present on locally shown partial/failed answers; such messages are never history. */
  provisional?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

interface SpeechRecognitionResult {
  [key: number]: {
    transcript: string;
  };
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [key: number]: SpeechRecognitionResult;
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type StreamState =
  | "idle"
  | "submitting"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"
  | "reconnecting";

type TerminalStatus = "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED";

interface OperationStatus {
  status: TerminalStatus | "RUNNING" | "PENDING";
  conversationId?: string | null;
  messageId?: string | null;
  balance?: number;
  content?: string;
  errorCode?: string | null;
}

/** Read the JSON payload of an SSE event; unnamed legacy events use `message`. */
function payloadOf(event: SseEvent): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(event.data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed payloads never become a successful completion.
  }
  return {};
}

function eventText(payload: Record<string, unknown>): string | null {
  const text = payload.text ?? payload.token;
  return typeof text === "string" ? text : null;
}

function operationKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/** Best-effort status reconciliation. 404/5xx leave the turn non-terminal. */
async function fetchOperationStatus(
  operationId: string,
  signal: AbortSignal,
): Promise<OperationStatus | null> {
  for (const path of [`/ai-operations/${operationId}`, `/chat/operations/${operationId}`]) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        signal,
      });
      if (!response.ok) continue;
      const body: unknown = await response.json();
      const payload = (
        body && typeof body === "object" && "data" in body
          ? (body as { data: unknown }).data
          : body
      ) as OperationStatus | null;
      if (payload && typeof payload.status === "string") return payload;
    } catch {
      // Endpoint not available (legacy backend) or request aborted: try the next.
    }
  }
  return null;
}

function isTerminalStatus(status: OperationStatus["status"] | undefined): status is TerminalStatus {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED" || status === "UNKNOWN";
}

function statusMessage(status: TerminalStatus, errorCode?: string | null): string {
  if (status === "SUCCEEDED") return "Response saved.";
  if (status === "CANCELLED") return "This turn was cancelled; no reply was saved.";
  if (status === "FAILED") return `The response failed${errorCode ? ` (${errorCode})` : ""}. No reply was saved.`;
  return "The operation ended in an unknown state. Please retry with the same turn.";
}

export default function ChatPage() {
  const { t } = useLanguageStore();
  const queryClient = useQueryClient();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("english");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  // Abort in-flight streams when the user switches conversations so their
  // callbacks cannot write the answer into the wrong chat.
  const abortStreamRef = useRef<AbortController | null>(null);
  const turnSeqRef = useRef(0);
  const keyRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConvId;

  // Keep speech recognition in sync with the selected target language.
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    let langCode = "en-US";
    if (targetLanguage === "vietnamese") langCode = "vi-VN";
    if (targetLanguage === "japanese") langCode = "ja-JP";
    if (targetLanguage === "korean") langCode = "ko-KR";
    if (targetLanguage === "french") langCode = "fr-FR";
    if (targetLanguage === "spanish") langCode = "es-ES";
    recognition.lang = langCode;
  }, [targetLanguage]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const windowWithSpeech = window as unknown as {
        SpeechRecognition?: new () => ISpeechRecognition;
        webkitSpeechRecognition?: new () => ISpeechRecognition;
      };
      const SpeechRecognition =
        windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;

        recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          if (currentTranscript.trim()) {
            setInput((prev) =>
              prev.trim()
                ? `${prev.trim()} ${currentTranscript.trim()}`
                : currentTranscript.trim(),
            );
          }
        };

        recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }
  }, []);

  useEffect(() => {
    apiClient
      .get("/chat/conversations")
      .then((r) => setConversations(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamState]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (!recognitionRef.current) {
        toast.error(t.speaking.browserWarning || "Speech recognition is not supported in this browser.");
        return;
      }

      let langCode = "en-US";
      if (targetLanguage === "vietnamese") langCode = "vi-VN";
      if (targetLanguage === "japanese") langCode = "ja-JP";
      if (targetLanguage === "korean") langCode = "ko-KR";
      if (targetLanguage === "french") langCode = "fr-FR";
      if (targetLanguage === "spanish") langCode = "es-ES";

      recognitionRef.current.lang = langCode;
      try {
        recognitionRef.current.start();
        setIsListening(true);
        // Do not clear the input here: a permission error or empty result
        // must never silently discard typed text.
      } catch (err) {
        console.error(err);
        setIsListening(false);
      }
    }
  };

  const refreshConversations = useCallback(() => {
    apiClient
      .get("/chat/conversations")
      .then((r) => setConversations(r.data))
      .catch(() => {});
  }, []);

  const releaseController = useCallback((controller: AbortController) => {
    // Only the request that still owns the ref may clear it.
    if (abortStreamRef.current === controller) abortStreamRef.current = null;
  }, []);

  const cancelTurn = useCallback(() => {
    const controller = abortStreamRef.current;
    turnSeqRef.current += 1; // invalidate callbacks from this turn
    controller?.abort();
    releaseController(controller ?? new AbortController());
    keyRef.current = null;
    setSending(false);
    setStreamState("cancelled");
    setStatusNote("This turn was cancelled; no reply was saved.");
  }, [releaseController]);

  const loadConversation = async (convId: string) => {
    const controller = abortStreamRef.current;
    controller?.abort();
    releaseController(controller ?? new AbortController());
    turnSeqRef.current += 1;
    keyRef.current = null;
    setSending(false);
    setStreamState("idle");
    setStatusNote(null);
    setActiveConvId(convId);
    try {
      const res = await apiClient.get(`/chat/conversations/${convId}/messages`);
      if (activeConvIdRef.current === convId) setMessages(res.data ?? []);
    } catch {
      if (activeConvIdRef.current === convId) setMessages([]);
    }
  };

  const handleNewConversation = () => {
    const controller = abortStreamRef.current;
    controller?.abort();
    releaseController(controller ?? new AbortController());
    turnSeqRef.current += 1;
    keyRef.current = null;
    setSending(false);
    setStreamState("idle");
    setStatusNote(null);
    setActiveConvId(null);
    setMessages([]);
  };

  /** Invalidations are permitted only after a verified terminal success/refund. */
  const onVerifiedTerminal = useCallback(
    (status: OperationStatus) => {
      if (status.status === "SUCCEEDED") {
        void queryClient.invalidateQueries({ queryKey: ["token-balance"] });
        const convId = status.conversationId ?? activeConvIdRef.current;
        if (convId) {
          void queryClient.invalidateQueries({ queryKey: ["chat", "conversations", convId, "messages"] });
          void queryClient.invalidateQueries({ queryKey: ["chat", convId] });
        }
        void queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
        refreshConversations();
      } else {
        // A refunded FAILED/CANCELLED operation also changes the balance.
        void queryClient.invalidateQueries({ queryKey: ["token-balance"] });
        void queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      }
    },
    [queryClient, refreshConversations],
  );

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    // One key per user turn, created at click time. It is reused for the whole
    // turn including 401 refresh and reconnects; never mint a second key here.
    const turnKey = keyRef.current ?? operationKey();
    keyRef.current = turnKey;

    const convId = activeConvIdRef.current;
    const turnId = ++turnSeqRef.current;
    const isCurrent = () => turnSeqRef.current === turnId && activeConvIdRef.current === convId;

    const userMsg: Message = { role: "user", content: input.trim() };
    // The new contract sends one turn only; DB history is the server's source
    // of truth, so no client-supplied assistant messages are forwarded.
    const message = userMsg.content;

    const allMessages = [...messagesRef.current, userMsg];
    setMessages(allMessages);
    setInput("");
    setSending(true);
    setStreamState("submitting");
    setStatusNote(null);

    const abortController = new AbortController();
    abortStreamRef.current = abortController;
    let assistantIdx = -1;
    let partial = "";
    let operationId: string | null = null;
    let terminalStatus: TerminalStatus | null = null;
    let terminalBalance: number | undefined;
    let terminalConversationId: string | null = null;
    let terminalErrorCode: string | null = null;
    let legacyDone = false;
    let sawNamedTerminal = false;

    const setAssistantContent = (content: string, provisional = true) => {
      if (!isCurrent() || assistantIdx < 0) return;
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length <= assistantIdx) return prev;
        updated[assistantIdx] = {
          role: "assistant",
          content,
          provisional,
        };
        return updated;
      });
    };

    const ensureAssistantPlaceholder = () => {
      if (!isCurrent() || assistantIdx >= 0) return;
      assistantIdx = allMessages.length;
      setMessages((prev) =>
        isCurrent()
          ? [...prev, { role: "assistant", content: "", provisional: true }]
          : prev,
      );
    };

    const applyEvent = (event: SseEvent) => {
      if (!isCurrent()) return;
      const data = payloadOf(event);
      switch (event.event) {
        case "accepted": {
          const acceptedOp = data.operationId;
          if (typeof acceptedOp === "string") operationId = acceptedOp;
          const acceptedConvId = data.conversationId;
          if (typeof acceptedConvId === "string" && !convId && activeConvIdRef.current === convId) {
            setActiveConvId(acceptedConvId);
            refreshConversations();
          }
          return;
        }
        case "delta":
        case "message": {
          // Unnamed `message` events are the legacy token stream.
          const text = eventText(data);
          if (text) {
            ensureAssistantPlaceholder();
            partial += text;
            setAssistantContent(partial);
            setStreamState("streaming");
          }
          return;
        }
        default:
          // Terminal events are classified by the shared parser's outcome.
          return;
      }
    };

    const applyOutcome = (outcome: SseOutcome) => {
      if (!isCurrent()) return;
      legacyDone = outcome.reason === "legacy-done";
      if (outcome.operationId) operationId = outcome.operationId;
      if (typeof outcome.balance === "number") terminalBalance = outcome.balance;
      const payload = outcome.event ? payloadOf(outcome.event) : {};

      if (outcome.status === "completed") {
        sawNamedTerminal = true;
        terminalStatus = "SUCCEEDED";
        const messageId = outcome.messageId ?? (
          typeof payload.messageId === "string" ? payload.messageId : null
        );
        terminalConversationId = typeof payload.conversationId === "string"
          ? payload.conversationId
          : convId;
        // A completed event can arrive before any delta (e.g. on replay).
        ensureAssistantPlaceholder();
        if (assistantIdx >= 0) {
          setMessages((prev) => {
            const updated = [...prev];
            if (updated.length > assistantIdx) {
              updated[assistantIdx] = {
                role: "assistant",
                content: partial,
                id: messageId ?? undefined,
                provisional: false,
              };
            }
            return updated;
          });
        }
        setStreamState("completed");
        return;
      }
      if (outcome.status === "failed") {
        terminalErrorCode = outcome.error?.code ?? null;
        setStreamState("failed");
        // Only a server-sent `failed` event is a verified terminal state. A
        // malformed local event stays unverified and must not invalidate balance.
        if (outcome.reason === "failed-event") {
          sawNamedTerminal = true;
          terminalStatus = "FAILED";
        }
      }
    };

    const reconcile = async () => {
      if (!isCurrent()) return;
      const hasVerifiedTerminal = sawNamedTerminal && terminalStatus !== null;
      if (!hasVerifiedTerminal && operationId) {
        setStreamState("reconnecting");
        const status = await fetchOperationStatus(operationId, abortController.signal);
        if (!isCurrent()) return;
        if (status && isTerminalStatus(status.status)) {
          terminalStatus = status.status;
          terminalErrorCode = status.errorCode ?? terminalErrorCode;
          terminalConversationId = status.conversationId ?? terminalConversationId;
          if (typeof status.balance === "number") terminalBalance = status.balance;
          if (status.status === "SUCCEEDED") {
            if (assistantIdx >= 0) {
              setAssistantContent(status.content ?? partial, false);
            }
            setStreamState("completed");
          } else {
            setStreamState(status.status === "FAILED" ? "failed" : "cancelled");
          }
        }
      }

      if (!isCurrent()) return;
      if (terminalStatus === "SUCCEEDED") {
        onVerifiedTerminal({
          status: "SUCCEEDED",
          conversationId: terminalConversationId,
          balance: terminalBalance,
        });
        if (typeof terminalBalance === "number") {
          queryClient.setQueryData(["token-balance"], (old: unknown) =>
            old && typeof old === "object"
              ? { ...(old as Record<string, unknown>), balance: terminalBalance }
              : { balance: terminalBalance },
          );
        }
        setStatusNote("Response saved.");
        keyRef.current = null;
        return;
      }

      if (terminalStatus !== null) {
        onVerifiedTerminal({ status: terminalStatus, errorCode: terminalErrorCode });
        setStatusNote(
          terminalStatus === "FAILED" || terminalStatus === "UNKNOWN" || terminalStatus === "CANCELLED"
            ? statusMessage(terminalStatus, terminalErrorCode)
            : "Response saved.",
        );
        keyRef.current = null;
        return;
      }

      // EOF without a verified terminal (including legacy [DONE]) is NOT success.
      setStreamState("failed");
      setStatusNote(
        legacyDone || partial
          ? "Connection ended before the response was confirmed. The partial text is not saved; retry this turn."
          : "The stream ended without a result. Retry this turn.",
      );
    };

    try {
      const doFetch = (authToken: string | null) =>
        fetch(`${API_BASE}/chat/stream`, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": turnKey,
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          // Single turn only. No client history, no client billing.
          body: JSON.stringify({
            conversationId: convId,
            language: targetLanguage,
            message,
            idempotencyKey: turnKey,
          }),
        });

      let response = await doFetch(getAccessToken());

      // The SSE stream bypasses the axios interceptor: on 401 refresh once
      // (single-flight) and retry with the SAME operation key.
      if (response.status === 401) {
        setStreamState("reconnecting");
        const newToken = await refreshAccessToken();
        if (!isCurrent()) return;
        if (newToken) response = await doFetch(newToken);
      }

      if (!response.ok || !response.body) {
        terminalStatus = "FAILED";
        setStreamState("failed");
        setStatusNote("The response failed. No reply was saved.");
        return;
      }

      if (!isCurrent()) return;
      setStreamState("streaming");

      const result = await parseSseStream(response.body, {
        signal: abortController.signal,
        treatLegacyDoneAsCompleted: false,
      });
      for (const event of result.events) {
        applyEvent(event);
        if (!isCurrent()) return;
      }
      applyOutcome(result.outcome);
      if (!isCurrent()) return;
      await reconcile();
    } catch {
      if (!isCurrent()) return;
      // Network failure: try to recover via status, keeping the same key.
      try {
        setStreamState("reconnecting");
        const status = await fetchOperationStatus(turnKey, abortController.signal);
        if (!isCurrent()) return;
        if (status && isTerminalStatus(status.status)) {
          terminalStatus = status.status;
          terminalErrorCode = status.errorCode ?? null;
          await reconcile();
          return;
        }
      } catch {
        /* no status endpoint on the legacy backend */
      }
      setStreamState("failed");
      setStatusNote("The connection was lost before the response was confirmed. Retry this turn.");
    } finally {
      releaseController(abortController);
      if (isCurrent()) setSending(false);
    }
  };

  const isBusy = sending && streamState !== "completed" && streamState !== "failed";
  const stateLabel = useMemo(() => {
    switch (streamState) {
      case "submitting":
        return t.chat.sending || "Sending...";
      case "reconnecting":
        return "Reconnecting to check this turn...";
      case "streaming":
        return "Streaming response...";
      case "completed":
        return "Response saved.";
      case "failed":
        return "Response not confirmed.";
      case "cancelled":
        return "Turn cancelled.";
      default:
        return null;
    }
  }, [streamState, t.chat.sending]);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Sidebar */}
      <div className="hidden w-64 flex-col gap-3 md:flex">
        <Button
          variant="gradient"
          size="sm"
          className="w-full"
          onClick={handleNewConversation}
        >
          <Plus className="mr-2 h-4 w-4" /> {t.chat.newChat}
        </Button>
        <label htmlFor="target-language" className="sr-only">
          Target Language
        </label>
        <select
          id="target-language"
          className="rounded-xl border bg-background px-3 py-2 text-xs transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          aria-label="Select target language for conversation"
        >
          <option value="english">{t.languages.english}</option>
          <option value="vietnamese">{t.languages.vietnamese}</option>
          <option value="japanese">{t.languages.japanese}</option>
          <option value="korean">{t.languages.korean}</option>
          <option value="french">{t.languages.french}</option>
          <option value="spanish">{t.languages.spanish}</option>
        </select>
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                activeConvId === conv.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => loadConversation(conv.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <p className="truncate">{conv.title}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <Card className="flex flex-1 flex-col overflow-hidden">
        {/* Chat Header */}
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t.chat.aiTutorName}</p>
            <p className="text-xs text-emerald-500">{t.chat.online}</p>
          </div>
        </div>

        <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto p-5 space-y-5"
            role="log"
            aria-live="polite"
            aria-label="Chat messages"
          >
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-primary/10 to-primary-light/10">
                  <Sparkles className="h-10 w-10 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">
                  {t.chat.aiTutorName}
                </h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {t.chat.aiTutorDesc}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    t.chat.suggestion1,
                    t.chat.suggestion2,
                    t.chat.suggestion3,
                  ].map((s) => (
                    <button
                      key={s}
                      className="rounded-full border bg-background px-4 py-2 text-xs transition-colors hover:bg-primary/5 hover:border-primary/30"
                      onClick={() => setInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={msg.id ?? i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-bg">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-3/4 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground"
                      : "rounded-2xl rounded-bl-md bg-muted px-4 py-3"
                  } ${msg.provisional ? "border border-dashed border-primary/30" : ""}`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.provisional && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Partial response — not saved until confirmed.
                    </p>
                  )}
                  {msg.role === "assistant" && msg.content && !msg.provisional && (
                    <button
                      type="button"
                      onClick={() => speakWord(msg.content)}
                      className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      aria-label={t.listening.play || "Listen"}
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {msg.role === "user" && <Avatar name="You" size="sm" />}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t bg-background/80 p-4 backdrop-blur-sm">
            <div className="mb-1.5 flex justify-end">
              <TokenCost feature="ai_chat" variant="badge" showWarning={true} />
            </div>
            {(stateLabel || statusNote) && (
              <div className="mb-2 flex items-center justify-between gap-3 text-xs" role="status">
                <span className="text-muted-foreground">{stateLabel}</span>
                {statusNote && <span className="text-amber-600 dark:text-amber-400">{statusNote}</span>}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              <label htmlFor="chat-input" className="sr-only">
                {t.chat.placeholder}
              </label>
              <Button
                type="button"
                variant={isListening ? "destructive" : "outline"}
                size="icon"
                className="h-11 w-11 rounded-xl shrink-0 transition-all"
                onClick={toggleListening}
                aria-label="Voice input"
                disabled={isBusy}
              >
                {isListening ? (
                  <MicOff className="h-4 w-4 animate-pulse" />
                ) : (
                  <Mic className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <input
                id="chat-input"
                className="h-11 flex-1 rounded-xl border bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/60 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={t.chat.placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isBusy}
                aria-label="Type your message"
              />
              {isBusy && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-xl shrink-0"
                  onClick={cancelTurn}
                  aria-label={t.common.cancel || "Cancel"}
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                type="submit"
                variant="gradient"
                size="icon"
                className="h-11 w-11 rounded-xl"
                disabled={isBusy || !input.trim()}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
