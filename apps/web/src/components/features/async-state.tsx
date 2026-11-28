"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Inbox, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/stores/language-store";

type StateClassName = string;

interface StateAppearanceProps {
  className?: StateClassName;
}

export interface LoadingStateProps extends StateAppearanceProps {
  label?: string;
  description?: string;
  /** Number of decorative skeleton rows; 0 disables them. Defaults to 3. */
  skeletonLines?: number;
  /** Show a spinner alongside the announcement. Defaults to true. */
  showSpinner?: boolean;
}

export interface EmptyStateProps extends StateAppearanceProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export interface ErrorStateProps extends StateAppearanceProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export interface OfflineStateProps extends StateAppearanceProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export type AsyncStateStatus = "loading" | "empty" | "error" | "offline" | "success";

export interface AsyncStateProps extends StateAppearanceProps {
  status: AsyncStateStatus;
  children?: ReactNode;
  /** Loading overrides. */
  label?: string;
  description?: string;
  skeletonLines?: number;
  showSpinner?: boolean;
  /** Empty overrides. */
  title?: string;
  action?: { label: string; onClick: () => void };
  /** Error / offline overrides. */
  onRetry?: () => void;
  retryLabel?: string;
}

/** Skeleton rows are decorative: the live region below carries the message. */
function SkeletonRows({ lines }: { lines: number }) {
  return (
    <div className="w-full max-w-sm space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn(
            "h-3 rounded-md bg-muted motion-safe:animate-pulse",
            index % 3 === 1 ? "w-4/5" : index % 3 === 2 ? "w-2/3" : "w-full",
          )}
        />
      ))}
    </div>
  );
}

export function LoadingState({
  label,
  description,
  skeletonLines = 3,
  showSpinner = true,
  className,
}: LoadingStateProps) {
  const { t } = useLanguageStore();
  const message = label ?? t.common.loadingShort;
  const detail = description ?? t.common.loadingDesc;
  const rows = Math.max(0, Math.min(8, Math.floor(skeletonLines)));

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-atomic="true"
      className={cn("flex flex-col items-center justify-center gap-3 px-4 py-10 text-center", className)}
    >
      <span className="sr-only">{`${message} ${detail}`}</span>
      {showSpinner && (
        <Loader2 className="h-6 w-6 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
      )}
      <p className="text-sm font-medium text-foreground" aria-hidden="true">
        {message}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground" aria-hidden="true">
        {detail}
      </p>
      {rows > 0 && <SkeletonRows lines={rows} />}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const { t } = useLanguageStore();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-border/70 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60"
        aria-hidden="true"
      >
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </span>
      <h3 className="text-sm font-semibold text-foreground">{title ?? t.common.emptyTitle}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { t } = useLanguageStore();

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-destructive/40 bg-destructive/5 px-6 py-5 text-left",
        className,
      )}
    >
      <div className="flex w-full items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title ?? t.common.errorTitle}</h3>
          <p className="text-sm text-muted-foreground">
            {description ?? t.common.errorDescription}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="ml-8">
          {retryLabel ?? t.common.retry}
        </Button>
      )}
    </div>
  );
}

export function OfflineState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: OfflineStateProps) {
  const { t } = useLanguageStore();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-border/70 bg-muted/30 px-6 py-5 text-left",
        className,
      )}
    >
      <div className="flex w-full items-start gap-3">
        <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title ?? t.common.offlineTitle}</h3>
          <p className="text-sm text-muted-foreground">
            {description ?? t.common.offlineDescription}
          </p>
        </div>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="ml-8">
          {retryLabel ?? t.common.retry}
        </Button>
      )}
    </div>
  );
}

/**
 * Single dispatcher for feature-level async states. Success renders children
 * without a wrapper live region, so dynamic content is not announced twice.
 */
export function AsyncState({
  status,
  children,
  className,
  label,
  description,
  skeletonLines,
  showSpinner,
  title,
  action,
  onRetry,
  retryLabel,
}: AsyncStateProps) {
  const { t } = useLanguageStore();

  switch (status) {
    case "loading":
      return (
        <LoadingState
          className={className}
          label={label}
          description={description}
          skeletonLines={skeletonLines}
          showSpinner={showSpinner}
        />
      );
    case "empty":
      return (
        <EmptyState
          className={className}
          title={title ?? t.common.emptyTitle}
          description={description}
          action={action}
        />
      );
    case "error":
      return (
        <ErrorState
          className={className}
          title={title}
          description={description}
          onRetry={onRetry}
          retryLabel={retryLabel}
        />
      );
    case "offline":
      return (
        <OfflineState
          className={className}
          title={title}
          description={description}
          onRetry={onRetry}
          retryLabel={retryLabel}
        />
      );
    case "success":
      return <>{children}</>;
  }
}

/** Tracks browser connectivity and reacts to online/offline events. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

/**
 * Shared network-error detection for non-React callers. Recognises axios-style
 * errors, DOM/transport failures and common fetch messages; HTTP failures with
 * a status code are deliberately excluded (those are real server responses).
 */
export function isOfflineError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    status?: unknown;
    response?: { status?: unknown };
    request?: unknown;
  };

  if (typeof candidate.status === "number" || typeof candidate.response?.status === "number") {
    return false;
  }

  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (
    code === "ERR_NETWORK" ||
    code === "ERR_INTERNET_DISCONNECTED" ||
    code === "ERR_CONNECTION_REFUSED" ||
    code === "ERR_NAME_NOT_RESOLVED" ||
    code === "ERR_TIMED_OUT" ||
    code === "ENOTFOUND"
  ) {
    return true;
  }

  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "TypeError" && typeof candidate.message === "string") {
    return /failed to fetch|networkerror|load failed/i.test(candidate.message);
  }

  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /network error|failed to fetch|socket hang up|internet connection|getaddrinfo/i.test(message);
}
