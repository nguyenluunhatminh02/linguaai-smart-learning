'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';

type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type StatusFilter = ReviewStatus | 'ALL';
type Decision = Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;

interface ReviewSubmission {
  id: string;
  contentItemId: string;
  authorId?: string;
  status: ReviewStatus;
  reviewerId?: string;
  reviewNotes?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  titleVi?: string;
  type?: string;
  language?: string;
  level?: string;
  content?: string | Record<string, unknown>;
  data?: Record<string, unknown>;
  questions?: unknown[];
  published?: boolean;
}

// Verified against ContentWorkflowController: PATCH .../approve and .../reject.
// apiClient baseURL already includes /api/v1.
const REVIEW_ENDPOINTS = {
  list: '/content-workflow/submissions',
  review: (id: string, decision: Decision) =>
    `/content-workflow/submissions/${encodeURIComponent(id)}/${decision === 'APPROVED' ? 'approve' : 'reject'}`,
} as const;

const STATUS_VARIANT: Record<
  ReviewStatus,
  'warning' | 'success' | 'destructive'
> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function pickString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeStatus(value: unknown): ReviewStatus {
  const status = typeof value === 'string' ? value.toUpperCase() : '';
  return status === 'APPROVED' || status === 'REJECTED' ? status : 'PENDING';
}

function normalizeSubmission(raw: unknown): ReviewSubmission | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const contentItemId =
    pickString(row, 'contentItemId', 'content_item_id') ?? '';
  const id =
    pickString(row, 'id', 'submissionId', 'submission_id') ?? contentItemId;
  if (!id) return null;

  return {
    id,
    contentItemId: contentItemId || id,
    authorId: pickString(row, 'authorId', 'author_id'),
    status: normalizeStatus(row.status),
    reviewerId: pickString(row, 'reviewerId', 'reviewer_id'),
    reviewNotes: pickString(row, 'reviewNotes', 'review_notes') ?? '',
    version: typeof row.version === 'number' ? row.version : undefined,
    createdAt: pickString(row, 'createdAt', 'created_at'),
    updatedAt: pickString(row, 'updatedAt', 'updated_at'),
    title: pickString(row, 'title', 'contentTitle') ?? pickString(row, 'name'),
    titleVi: pickString(row, 'titleVi', 'title_vi'),
    type: pickString(row, 'type'),
    language: pickString(row, 'language'),
    level: pickString(row, 'level'),
    content:
      typeof row.content === 'string' ||
      (row.content !== null && typeof row.content === 'object')
        ? (row.content as string | Record<string, unknown>)
        : undefined,
    data:
      row.data !== null && typeof row.data === 'object'
        ? (row.data as Record<string, unknown>)
        : undefined,
    questions: Array.isArray(row.questions) ? row.questions : undefined,
    published:
      typeof row.published === 'boolean'
        ? row.published
        : typeof row.isPublished === 'boolean'
          ? row.isPublished
          : undefined,
  };
}

function toSubmissionList(payload: unknown): ReviewSubmission[] {
  let rows: unknown[] = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.items)) rows = obj.items;
    else if (Array.isArray(obj.submissions)) rows = obj.submissions;
    else if (Array.isArray(obj.results)) rows = obj.results;
  }
  return rows
    .map(normalizeSubmission)
    .filter((item): item is ReviewSubmission => item !== null);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const err = error as {
      message?: unknown;
      response?: { data?: { message?: unknown; error?: unknown } };
    };
    const message =
      err.response?.data?.message ?? err.response?.data?.error ?? err.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) {
      const joined = message
        .filter((item): item is string => typeof item === 'string')
        .join(', ');
      if (joined) return joined;
    }
  }
  return fallback;
}

function previewText(submission: ReviewSubmission): string {
  const source = submission.content ?? submission.data ?? submission.questions;
  if (source === undefined) return '—';
  if (typeof source === 'string') return source;
  try {
    return JSON.stringify(source, null, 2);
  } catch {
    return String(source);
  }
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TeacherReviewPage() {
  const { t, locale } = useLanguageStore();
  const { user } = useAuthStore();

  const copy = useMemo(
    () =>
      locale === 'vi'
        ? {
            title: 'Duyệt nội dung',
            subtitle: 'Xem xét tài liệu giáo viên gửi trước khi xuất bản.',
            notAllowed: 'Chỉ quản trị viên hoặc kiểm duyệt viên mới được duyệt nội dung.',
            inQueue: 'bài chờ duyệt',
            refresh: 'Làm mới',
            filterLabel: 'Lọc theo trạng thái',
            all: 'Tất cả',
            pending: 'Chờ duyệt',
            approved: 'Đã duyệt',
            rejected: 'Từ chối',
            details: 'Chi tiết',
            approve: 'Duyệt',
            reject: 'Từ chối',
            notesLabel: 'Ghi chú duyệt',
            notesPlaceholder: 'Giải thích quyết định cho tác giả...',
            rejectNeedsNotes: 'Hãy thêm ghi chú trước khi từ chối.',
            loadFailed: 'Không tải được hàng đợi duyệt.',
            actionFailed: 'Không lưu được quyết định duyệt.',
            emptyTitle: 'Không có nội dung cần duyệt',
            emptyDesc: 'Không có bài nào khớp bộ lọc này.',
            reviewing: 'Đang lưu...',
            content: 'Xem trước nội dung',
            author: 'Tác giả',
            submitted: 'Đã gửi',
            updated: 'Cập nhật',
            version: 'Phiên bản',
            reviewer: 'Người duyệt',
          }
        : {
            title: 'Content review',
            subtitle: 'Review submitted teaching material before publication.',
            notAllowed: 'Only admins and moderators can review content.',
            inQueue: 'submissions',
            refresh: 'Refresh',
            filterLabel: 'Filter by status',
            all: 'All statuses',
            pending: 'Pending',
            approved: 'Approved',
            rejected: 'Rejected',
            details: 'Details',
            approve: 'Approve',
            reject: 'Reject',
            notesLabel: 'Review notes',
            notesPlaceholder: 'Explain the decision for the author...',
            rejectNeedsNotes: 'Add review notes before rejecting a submission.',
            loadFailed: 'Could not load the review queue.',
            actionFailed: 'Could not save the review decision.',
            emptyTitle: 'Nothing to review',
            emptyDesc: 'No submissions match this filter.',
            reviewing: 'Saving...',
            content: 'Content preview',
            author: 'Author',
            submitted: 'Submitted',
            updated: 'Updated',
            version: 'Version',
            reviewer: 'Reviewer',
          },
    [locale],
  );

  const role = (user?.role ?? '').toLowerCase();
  const canReview = role === 'admin' || role === 'moderator';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchQueue = useCallback(
    async (nextStatus: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.get<unknown>(REVIEW_ENDPOINTS.list, {
          params: nextStatus === 'ALL' ? undefined : { status: nextStatus },
        });
        setSubmissions(toSubmissionList(response.data));
      } catch (err) {
        setError(errorMessage(err, copy.loadFailed));
        setSubmissions([]);
      } finally {
        setLoading(false);
      }
    },
    [copy.loadFailed],
  );

  useEffect(() => {
    if (!canReview) return;
    void fetchQueue(statusFilter);
  }, [canReview, fetchQueue, statusFilter]);

  const submitDecision = async (
    submission: ReviewSubmission,
    decision: Decision,
  ) => {
    if (!canReview || busyId) return;
    const id = submission.id || submission.contentItemId;
    if (!id) return;

    const reviewNotes = (notes[id] ?? submission.reviewNotes ?? '').trim();
    if (decision === 'REJECTED' && !reviewNotes) {
      setActionError(copy.rejectNeedsNotes);
      return;
    }

    // ReviewSubmissionDto accepts reviewNotes and an optional optimistic
    // version. The global ValidationPipe forbids unknown fields, so never send
    // `status` or `notes` here.
    const body = {
      ...(reviewNotes ? { reviewNotes } : {}),
      ...(typeof submission.version === 'number'
        ? { version: submission.version }
        : {}),
    };

    setBusyId(id);
    setActionError(null);
    try {
      const response = await apiClient.patch<unknown>(
        REVIEW_ENDPOINTS.review(id, decision),
        body,
      );
      const updated = normalizeSubmission(response.data);
      setSubmissions((current) =>
        current
          .map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...(updated ?? {}),
                  id,
                  status: decision,
                  reviewNotes,
                }
              : item,
          )
          .filter(
            (item) => statusFilter === 'ALL' || statusFilter === item.status,
          ),
      );
      setNotes((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (err) {
      setActionError(errorMessage(err, copy.actionFailed));
    } finally {
      setBusyId(null);
    }
  };

  const statusLabel = (status: ReviewStatus) =>
    status === 'PENDING'
      ? copy.pending
      : status === 'APPROVED'
        ? copy.approved
        : copy.rejected;

  if (!canReview) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <AlertCircle
            className="h-5 w-5 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <span>{copy.notAllowed}</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            <ClipboardCheck
              className="mr-1 h-3.5 w-3.5"
              aria-hidden="true"
            />
            {submissions.length} {copy.inQueue}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchQueue(statusFilter)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            {copy.refresh}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="review-status" className="sr-only">
          {copy.filterLabel}
        </label>
        <select
          id="review-status"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
          className="input-cls w-44"
          aria-label={copy.filterLabel}
        >
          <option value="PENDING">{copy.pending}</option>
          <option value="APPROVED">{copy.approved}</option>
          <option value="REJECTED">{copy.rejected}</option>
          <option value="ALL">{copy.all}</option>
        </select>
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void fetchQueue(statusFilter)}
          >
            {copy.refresh}
          </Button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 rounded-2xl border border-border py-20 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t.common.loading}
        </div>
      ) : submissions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
          <ClipboardCheck
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">{copy.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{copy.emptyDesc}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => {
            const key = submission.id;
            const isBusy = busyId === key;
            const isOpen = expandedId === key;
            const title =
              (locale === 'vi' && submission.titleVi
                ? submission.titleVi
                : submission.title || '') || submission.contentItemId;

            return (
              <Card key={key}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText
                          className="h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <h2 className="truncate text-sm font-semibold">
                          {title}
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[submission.type, submission.language, submission.level]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[submission.status]}>
                      {statusLabel(submission.status)}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {copy.author}: {submission.authorId ?? '—'}
                    </span>
                    <span>
                      {copy.submitted}: {formatDate(submission.createdAt)}
                    </span>
                    <span>
                      {copy.updated}: {formatDate(submission.updatedAt)}
                    </span>
                    <span>
                      {copy.version}: {submission.version ?? '—'}
                    </span>
                    {submission.reviewerId && (
                      <span>
                        {copy.reviewer}: {submission.reviewerId}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`review-notes-${key}`} className="sr-only">
                        {copy.notesLabel}
                      </label>
                      <textarea
                        id={`review-notes-${key}`}
                        className="input-cls min-h-20 w-full"
                        placeholder={copy.notesPlaceholder}
                        value={notes[key] ?? submission.reviewNotes ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedId(isOpen ? null : key)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                        {copy.details}
                      </Button>
                      <Button
                        variant="gradient"
                        size="sm"
                        disabled={isBusy || submission.status === 'APPROVED'}
                        onClick={() =>
                          void submitDecision(submission, 'APPROVED')
                        }
                      >
                        {isBusy ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
                        {isBusy ? copy.reviewing : copy.approve}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isBusy || submission.status === 'REJECTED'}
                        onClick={() =>
                          void submitDecision(submission, 'REJECTED')
                        }
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        {copy.reject}
                      </Button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {copy.content}
                      </p>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-xs">
                        {previewText(submission)}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
