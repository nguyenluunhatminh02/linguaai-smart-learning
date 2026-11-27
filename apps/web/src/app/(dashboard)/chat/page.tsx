"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiClient, refreshAccessToken } from "@/lib/api-client";
import { getAccessToken } from "@/stores/auth-store";
import { Avatar } from "@/components/ui/avatar";
import { MessageSquare, Send, Plus, Bot, User, Sparkles, Mic, MicOff, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { speakWord } from "@/lib/speech";
import { useLanguageStore } from "@/stores/language-store";
import { TokenCost, useTokenGate } from "@/components/ui/token-cost";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
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

export default function ChatPage() {
  const { t } = useLanguageStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("english");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  // Abort in-flight streams when the user switches conversations so their
  // callbacks cannot write the answer into the wrong chat.
  const abortStreamRef = useRef<AbortController | null>(null);
  const streamSeqRef = useRef(0);
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
      const SpeechRecognition = windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
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
            // Append to anything already typed instead of replacing it.
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

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (!recognitionRef.current) {
        toast.error(t.speaking.browserWarning || "Speech recognition is not supported in this browser.");
        return;
      }

      let langCode = 'en-US';
      if (targetLanguage === 'vietnamese') langCode = 'vi-VN';
      if (targetLanguage === 'japanese') langCode = 'ja-JP';
      if (targetLanguage === 'korean') langCode = 'ko-KR';
      if (targetLanguage === 'french') langCode = 'fr-FR';
      if (targetLanguage === 'spanish') langCode = 'es-ES';

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

  useEffect(() => {
    apiClient
      .get("/chat/conversations")
      .then((r) => setConversations(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversation = async (convId: string) => {
    // Cancel any in-flight stream so its callbacks cannot write into this
    // newly selected conversation.
    abortStreamRef.current?.abort();
    abortStreamRef.current = null;
    streamSeqRef.current += 1;
    setSending(false);
    setActiveConvId(convId);
    try {
      const res = await apiClient.get(`/chat/conversations/${convId}/messages`);
      // Guard against a second switch while this request was in flight.
      if (activeConvIdRef.current === convId) setMessages(res.data);
    } catch {
      if (activeConvIdRef.current === convId) setMessages([]);
    }
  };

  const handleNewConversation = () => {
    abortStreamRef.current?.abort();
    abortStreamRef.current = null;
    streamSeqRef.current += 1;
    setSending(false);
    setActiveConvId(null);
    setMessages([]);
  };

  const { consumeAndRun, canAfford: canAffordChat } = useTokenGate("ai_chat");

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    if (!canAffordChat) {
      toast.error(t.common.insufficientTokens || "Insufficient token balance");
      return;
    }

    // Capture the conversation at send time. Only messages belonging to it
    // may be sent to /chat/stream or /chat/send.
    const convId = activeConvIdRef.current;
    const streamId = ++streamSeqRef.current;
    const isCurrent = () =>
      streamSeqRef.current === streamId && activeConvIdRef.current === convId;

    const userMsg: Message = { role: "user", content: input.trim() };
    // Use the ref snapshot: `messages` from the closure may be from a
    // different conversation if the user switched while a stream was active.
    const allMessages = [...messagesRef.current, userMsg];
    const promptMessages = allMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages(allMessages);
    setInput("");
    setSending(true);

    // Save the turn to history. The backend derives the stored assistant
    // reply from the prompt, so only call this for a successful stream —
    // calling it on failure would bill the user and store a different answer.
    const persist = async () => {
      try {
        const saveRes = await apiClient.post("/chat/send", {
          messages: promptMessages,
          conversationId: convId || undefined,
          language: targetLanguage,
        });
        const newConvId = saveRes.data.conversationId;
        if (!convId && newConvId && isCurrent()) {
          setActiveConvId(newConvId);
          apiClient
            .get("/chat/conversations")
            .then((r) => setConversations(r.data))
            .catch(() => {});
        }
      } catch {
        /* history save is best-effort */
      }
    };

    const abortController = new AbortController();
    abortStreamRef.current = abortController;
    let assistantIdx = -1;

    const setAssistantContent = (content: string) => {
      if (!isCurrent() || assistantIdx < 0) return;
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length <= assistantIdx) return prev;
        updated[assistantIdx] = { role: "assistant", content };
        return updated;
      });
    };

    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const doFetch = (authToken: string | null) =>
        fetch(`${baseUrl}/chat/stream`, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            messages: promptMessages,
            language: targetLanguage,
          }),
        });

      let response = await doFetch(getAccessToken());

      // The SSE stream bypasses the axios interceptor, so handle token refresh
      // here: on 401 refresh once (single-flight) and retry before giving up.
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) response = await doFetch(newToken);
      }

      if (!response.ok || !response.body) throw new Error("Stream failed");

      if (!isCurrent()) return;
      assistantIdx = allMessages.length;
      setMessages((prev) =>
        isCurrent() ? [...prev, { role: "assistant", content: "" }] : prev,
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE events may be split across chunks; buffer incomplete lines.
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              streamError =
                typeof parsed.error === "string"
                  ? parsed.error
                  : parsed.error.message || "Stream failed";
              break;
            }
            if (parsed.token) {
              fullContent += parsed.token;
              setAssistantContent(fullContent);
            }
          } catch {
            /* skip malformed lines */
          }
        }
        if (streamError) break;
      }

      if (!isCurrent()) return;

      if (streamError) {
        // Never bill or persist a fabricated answer for a failed stream.
        setAssistantContent(`Sorry, something went wrong: ${streamError}`);
        return;
      }

      await persist();
      // Deduct tokens only after a successful, complete response.
      await consumeAndRun(async () => {});
    } catch {
      if (!isCurrent()) return;
      setAssistantContent(
        "Sorry, something went wrong. Please try again.",
      );
    } finally {
      abortStreamRef.current = null;
      if (isCurrent()) setSending(false);
    }
  };

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
                key={i}
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
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.role === "assistant" && msg.content && (
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
            {sending && messages[messages.length - 1]?.content === "" && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-bg">
                  <Bot className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="typing-dot h-2 w-2 rounded-full bg-muted-foreground/50" />
                    <span className="typing-dot delay-200 h-2 w-2 rounded-full bg-muted-foreground/50" />
                    <span className="typing-dot delay-400 h-2 w-2 rounded-full bg-muted-foreground/50" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t bg-background/80 p-4 backdrop-blur-sm">
            <div className="mb-1.5 flex justify-end">
              <TokenCost feature="ai_chat" variant="badge" showWarning={true} />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
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
              >
                {isListening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4 text-muted-foreground" />}
              </Button>
              <input
                id="chat-input"
                className="h-11 flex-1 rounded-xl border bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/60 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={t.chat.placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sending}
                aria-label="Type your message"
              />
              <Button
                type="submit"
                variant="gradient"
                size="icon"
                className="h-11 w-11 rounded-xl"
                disabled={sending || !input.trim()}
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
