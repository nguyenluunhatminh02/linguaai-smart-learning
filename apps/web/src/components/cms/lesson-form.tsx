"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { getAccessToken } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import {
  lessonSchema,
  type LessonFormData,
} from "@/lib/validation/lesson.schema";
import { ImageUpload, MultiImageUpload } from "@/components/cms/image-upload";
import { AudioUpload } from "@/components/cms/audio-upload";
import type {
  CmsLesson,
  LessonType,
  LessonLanguage,
  LessonContent,
  GrammarContent,
  TranslationContent,
  ReadingContent,
  VocabularyContent,
  ListeningContent,
} from "@/lib/types/cms";
import {
  LEVEL_OPTIONS,
  CATEGORY_OPTIONS,
  createEmptyContent,
  normalizeListeningAnswers,
} from "@/lib/types/cms";

/* ══════════════════════════════════════════════════════════════
   FE-13: CMS LESSON FORM SPLIT
   ──────────────────────────────────────────────────────────────
   This file contains logically separated sections:
     1. Utilities (slugify, URL normalization, error flattening)
     2. Draft persistence (sessionStorage, per-type content bag)
     3. LessonMetaFields (shared meta form fields)
     4. EditorRouter (type switch)
     5. Content editors (grammar, translation, reading, vocabulary, listening)
     6. LessonForm (composition/shell with validation + save)
   NOTE: Kept in one file because the task scope allows only this file.
   ══════════════════════════════════════════════════════════════ */

interface Props {
  initial?: CmsLesson; // undefined → create mode
  backUrl?: string; // where to navigate after save (default: '/cms')
}

type ContentByType = Partial<Record<LessonType, LessonContent>>;

/* ──────────────────────────────────────────────────────────────
   Section 1: Utility Functions
   ────────────────────────────────────────────────────────────── */

function slugify(s: string): string {
  // Normalize unicode letters → ASCII where possible, then remove non-slug chars
  const latin = s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // strip diacritics
  const ascii = latin
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "-")
    .trim();
  const slug = ascii.replace(/[\s-]+/g, "-").replace(/(^-|-$)/g, "");
  // If result is empty (pure CJK title), generate timestamp-based fallback
  return slug || `lesson-${Date.now()}`;
}

/** Upload endpoints may return root-relative paths; turn them into absolute
 * URLs so the lesson schema (z.string().url()) accepts them on save. */
function normalizeUploadUrl(url: string): string {
  if (!url || typeof window === "undefined") return url;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url) || url.startsWith("//")) return url;
  if (url.startsWith("/")) return `${window.location.origin}${url}`;
  return url;
}

/** Human-readable label for a react-hook-form validation error path. */
function formatErrorPath(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, " #$1")
    .replace(/^content\./, "")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();
}

/** Flatten nested zod validation errors into a readable list. */
function collectErrorMessages(
  errors: Record<string, unknown>,
  prefix = "",
): { path: string; message: string }[] {
  const result: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(errors ?? {})) {
    if (!value || typeof value !== "object") continue;
    const node = value as { message?: unknown } & Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof node.message === "string") {
      result.push({ path, message: node.message });
    } else {
      result.push(...collectErrorMessages(node, path));
    }
  }
  return result;
}

/* ──────────────────────────────────────────────────────────────
   Section 2: Draft Persistence (Session-scoped)
   ──────────────────────────────────────────────────────────────
   Preserves unsaved edits across refreshes. Client-only (effect), keyed
   by lesson id or 'new'. Stores a per-type content bag so switching
   lesson types never destroys another type's in-progress content.
   ────────────────────────────────────────────────────────────── */

const DRAFT_VERSION = 1;
const DRAFT_KEY_PREFIX = "lesson-form-draft:";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DraftData {
  version: number;
  updatedAt: number;
  type: LessonType;
  contentByType: ContentByType;
  meta: Partial<LessonFormData>;
}

function getDraftKey(initial?: CmsLesson): string {
  return `${DRAFT_KEY_PREFIX}${initial?.id || "new"}`;
}

function loadDraft(initial?: CmsLesson): DraftData | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getDraftKey(initial);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftData;
    if (draft?.version !== DRAFT_VERSION) return null;
    if (Date.now() - draft.updatedAt > DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    // A newer server version supersedes the local draft.
    if (initial && draft.updatedAt < new Date(initial.updatedAt).getTime()) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (!draft.contentByType || typeof draft.contentByType !== "object") return null;
    return draft;
  } catch {
    return null;
  }
}

function saveDraft(
  initial: CmsLesson | undefined,
  type: LessonType,
  contentByType: ContentByType,
  meta: Partial<LessonFormData>,
): void {
  if (typeof window === "undefined") return;
  try {
    const draft: DraftData = {
      version: DRAFT_VERSION,
      updatedAt: Date.now(),
      type,
      contentByType,
      meta,
    };
    sessionStorage.setItem(getDraftKey(initial), JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — non-fatal.
  }
}

function clearDraft(initial?: CmsLesson): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(getDraftKey(initial));
  } catch {
    // Ignore.
  }
}

/* ──────────────────────────────────────────────────────────────
   Section 3: Reusable UI helpers
   ────────────────────────────────────────────────────────────── */

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
  error,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function BtnAdd({ onClick, label }: { onClick: () => void, label?: string }) {
  const { t } = useLanguageStore();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition"
    >
      <Plus className="h-3.5 w-3.5" /> {label || t.admin.addBtnLabel}
    </button>
  );
}

function BtnRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 rounded p-1 text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 transition"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   Section 4: LessonForm (composition/shell)
   ══════════════════════════════════════════════════════════════ */

export function LessonForm({ initial, backUrl = "/cms" }: Props) {
  const router = useRouter();
  const isEdit = !!initial;
  const { t } = useLanguageStore();
  const [validationIssues, setValidationIssues] = useState<
    { path: string; message: string }[]
  >([]);

  // Per-type content bag: switching type never destroys other types' work.
  const initialType: LessonType = initial?.type ?? "grammar";
  const initialContent = initial
    ? (normalizeListeningAnswers(initial).content as LessonContent)
    : createEmptyContent("grammar");
  const [contentByType, setContentByType] = useState<ContentByType>(() => ({
    [initialType]: initialContent,
  }));
  const contentByTypeRef = useRef(contentByType);
  contentByTypeRef.current = contentByType;

  // ── React Hook Form setup ─────────────────────────────────
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LessonFormData>({
    resolver: zodResolver(lessonSchema),
    defaultValues: initial
      ? ({
          type: initial.type,
          language: initial.language,
          level: initial.level,
          title: initial.title,
          titleVi: initial.titleVi,
          slug: initial.slug,
          category: initial.category,
          categoryVi: initial.categoryVi,
          description: initial.description,
          thumbnail: initial.thumbnail,
          images: initial.images,
          source: initial.source,
          isPublished: initial.isPublished,
          sortOrder: initial.sortOrder,
          content: initialContent as LessonFormData["content"],
        } as LessonFormData)
      : ({
          type: "grammar",
          language: "japanese",
          level: "N5",
          title: "",
          titleVi: "",
          slug: "",
          category: "",
          categoryVi: "",
          description: "",
          thumbnail: "",
          images: [],
          source: "",
          isPublished: false,
          sortOrder: 0,
          content: createEmptyContent("grammar") as LessonFormData["content"],
        } as LessonFormData),
  });

  // Watch form values for controlled components
  const type = watch("type");
  const language = watch("language");
  const level = watch("level");
  const title = watch("title");
  const category = watch("category");
  const isPublished = watch("isPublished");
  const content = contentByType[type] ?? createEmptyContent(type);

  // ── Restore draft (client-only effect — no SSR mismatch) ──
  const draftRestored = useRef(false);
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    const draft = loadDraft(initial);
    if (!draft) return;
    const restoredType = draft.type;
    const restoredContent = draft.contentByType[restoredType];
    setContentByType((prev) =>
      restoredContent ? { ...prev, ...draft.contentByType } : prev,
    );
    setValue("type", restoredType);
    setValue("content", (restoredContent ?? createEmptyContent(restoredType)) as LessonFormData["content"]);
    const meta = draft.meta;
    for (const key of Object.keys(meta) as (keyof LessonFormData)[]) {
      const value = meta[key];
      if (value !== undefined) setValue(key, value as never);
    }
  }, [initial, setValue]);

  // ── Sync active content + per-type bag to form ────────────
  useEffect(() => {
    setValue("content", content as LessonFormData["content"]);
  }, [content, type, setValue]);

  // ── Persist draft on change (debounced via effect) ────────
  useEffect(() => {
    if (!draftRestored.current) return;
    const timer = window.setTimeout(() => {
      const values = getValues();
      const meta: Partial<LessonFormData> = {};
      for (const key of [
        "language", "level", "title", "titleVi", "slug", "category",
        "categoryVi", "description", "thumbnail", "images", "source",
        "isPublished", "sortOrder",
      ] as (keyof LessonFormData)[]) {
        (meta as Record<string, unknown>)[key] = values[key];
      }
      saveDraft(initial, values.type, contentByTypeRef.current, meta);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [initial, type, language, level, title, category, isPublished, content, contentByType, getValues]);

  const handleContentChange = useCallback(
    (next: LessonContent) => {
      setContentByType((prev) => ({ ...prev, [type]: next }));
    },
    [type],
  );

  // Switching types preserves each type's in-progress content. Category is
  // only cleared when it is no longer valid for the new type.
  const handleTypeChange = (nextType: LessonType) => {
    const currentCategory = getValues("category");
    const categoryIsValid = CATEGORY_OPTIONS[nextType].some(
      (c) => c.id === currentCategory,
    );
    setValue("type", nextType);
    const nextContent = contentByTypeRef.current[nextType] ?? createEmptyContent(nextType);
    setContentByType((prev) => ({ ...prev, [nextType]: nextContent }));
    setValue("content", nextContent as LessonFormData["content"]);
    if (!currentCategory || !categoryIsValid) {
      setValue("category", "");
      setValue("categoryVi", "");
    }
    setValidationIssues([]);
  };

  // When language changes, reset level to first option
  const handleLanguageChange = (l: LessonLanguage) => {
    setValue("language", l);
    setValue("level", LEVEL_OPTIONS[l][0]);
  };

  // Auto-generate slug from title (never in edit mode)
  const handleTitleChange = (v: string) => {
    setValue("title", v);
    if (!isEdit) setValue("slug", slugify(v));
  };

  // ── Save with validation ───────────────────────────────────
  const onSubmit = async (data: LessonFormData) => {
    setValidationIssues([]);
    try {
      const url = isEdit
        ? `/api/cms/lessons/${initial!.id}`
        : "/api/cms/lessons";
      const method = isEdit ? "PUT" : "POST";
      const token = getAccessToken();

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Save failed");
        return;
      }

      clearDraft(initial);
      toast.success(isEdit ? "Lesson updated" : "Lesson created");
      window.location.href = backUrl;
    } catch {
      toast.error("An error occurred while saving");
    }
  };

  const onError = (formErrors: typeof errors) => {
    const issues = collectErrorMessages(formErrors as unknown as Record<string, unknown>);
    setValidationIssues(issues);
    toast.error(
      issues.length > 0
        ? `Please fix ${issues.length} validation error${issues.length === 1 ? "" : "s"} before saving`
        : "Please fix the validation errors before saving",
    );
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* ── Validation errors (including nested content fields) ─── */}
      {validationIssues.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          <p className="mb-2 font-semibold">Please fix the following:</p>
          <ul className="list-inside list-disc space-y-1">
            {validationIssues.map((issue) => (
              <li key={issue.path}>
                <span className="font-medium">
                  {formatErrorPath(issue.path)}:{" "}
                </span>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(backUrl)}
            className="rounded-lg p-2 hover:bg-muted transition"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">
              {isEdit ? t.admin.editLesson : t.admin.createLesson}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEdit
                ? `ID: ${initial!.id}`
                : t.admin.fillInfo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setValue("isPublished", !isPublished)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              isPublished
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {isPublished ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
            {isPublished ? t.admin.published : t.admin.draft}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(onSubmit, onError)()}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSubmitting ? t.admin.saving : t.admin.saveLesson}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        {/* ── Left Column: Content ──────────────────────────── */}
        <div className="space-y-6 xl:col-span-2">
          {/* ── Meta fields (isolated component) ────────────── */}
          <LessonMetaFields
            register={register}
            setValue={setValue}
            watch={watch}
            errors={errors}
            type={type}
            language={language}
            level={level}
            title={title}
            handleTypeChange={handleTypeChange}
            handleLanguageChange={handleLanguageChange}
            handleTitleChange={handleTitleChange}
          />

          {/* ── Content editor router (type switch) ─────────── */}
          <Card title={t.admin.lessonContent}>
            <EditorRouter
              type={type}
              content={content}
              onChange={handleContentChange}
              language={language}
              level={level}
            />
          </Card>
        </div>

        {/* ── Right Column: Media & Settings ────────────────── */}
        <div className="space-y-6">
          <Card title={t.admin.thumbnail}>
            <ImageUpload
              value={watch("thumbnail") || ""}
              onChange={(url) => setValue("thumbnail", normalizeUploadUrl(url))}
              label=""
            />
            {errors.thumbnail && (
              <p className="mt-1 text-xs text-red-600">
                {errors.thumbnail.message}
              </p>
            )}
          </Card>

          <Card title={t.admin.lessonImages}>
            <MultiImageUpload
              value={watch("images") || []}
              onChange={(urls) => setValue("images", urls.map(normalizeUploadUrl))}
              label=""
            />
            {errors.images && (
              <p className="mt-1 text-xs text-red-600">
                {errors.images.message}
              </p>
            )}
          </Card>

          <Card title={t.admin.settings}>
            <Field label={t.admin.sortOrder} error={errors.sortOrder?.message}>
              <input
                type="number"
                {...register("sortOrder", { valueAsNumber: true })}
                className="input-cls w-24"
              />
            </Field>
            <div className="mt-3 text-xs text-muted-foreground">
              {t.admin.sortOrderHint}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Section 5: LessonMetaFields (shared metadata form)
   ══════════════════════════════════════════════════════════════ */

type FieldErrors = ReturnType<typeof useForm<LessonFormData>>["formState"]["errors"];
type UseFormRegister = ReturnType<typeof useForm<LessonFormData>>["register"];
type UseFormSetValue = ReturnType<typeof useForm<LessonFormData>>["setValue"];
type UseFormWatch = ReturnType<typeof useForm<LessonFormData>>["watch"];

function LessonMetaFields({
  register,
  setValue,
  watch,
  errors,
  type,
  language,
  level,
  title,
  handleTypeChange,
  handleLanguageChange,
  handleTitleChange,
}: {
  register: UseFormRegister;
  setValue: UseFormSetValue;
  watch: UseFormWatch;
  errors: FieldErrors;
  type: LessonType;
  language: LessonLanguage;
  level: string;
  title: string;
  handleTypeChange: (t: LessonType) => void;
  handleLanguageChange: (l: LessonLanguage) => void;
  handleTitleChange: (v: string) => void;
}) {
  const { t } = useLanguageStore();

  return (
    <Card title={t.admin.basicInfo}>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t.admin.lessonType}>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as LessonType)}
            className="input-cls"
          >
            <option value="grammar">{t.admin.typeGrammar}</option>
            <option value="translation">{t.admin.typeTranslation}</option>
            <option value="reading">{t.admin.typeReading}</option>
            <option value="vocabulary">{t.admin.typeVocabulary}</option>
            <option value="listening">{t.admin.typeListening}</option>
          </select>
        </Field>

        <Field label={t.admin.language}>
          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value as LessonLanguage)}
            className="input-cls"
          >
            <option value="english">{t.admin.langEnglish}</option>
            <option value="chinese">{t.admin.langChinese}</option>
            <option value="japanese">{t.admin.langJapanese}</option>
          </select>
        </Field>

        <Field label={t.admin.level} error={errors.level?.message}>
          <select
            {...register("level")}
            value={level}
            onChange={(e) => setValue("level", e.target.value)}
            className="input-cls"
          >
            {LEVEL_OPTIONS[language].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t.admin.category} error={errors.category?.message}>
          <select
            {...register("category")}
            value={watch("category")}
            onChange={(e) => {
              setValue("category", e.target.value);
              const cat = CATEGORY_OPTIONS[type].find(
                (c) => c.id === e.target.value,
              );
              if (cat) setValue("categoryVi", cat.labelVi);
            }}
            className="input-cls"
          >
            <option value="">{t.admin.categoryPlaceholder}</option>
            {CATEGORY_OPTIONS[type].map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelVi} ({c.label})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label={t.admin.titleOriginal} error={errors.title?.message}>
          <input
            {...register("title")}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="input-cls"
            placeholder="e.g. て形の使い方"
          />
        </Field>
        <Field label={t.admin.titleVietnamese} error={errors.titleVi?.message}>
          <input
            {...register("titleVi")}
            className="input-cls"
            placeholder="e.g. Cách dùng thể て"
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label={t.admin.slugUrl} error={errors.slug?.message}>
          <input
            {...register("slug")}
            className="input-cls font-mono text-sm"
            placeholder="ten-bai-hoc"
          />
        </Field>
        <Field label={t.admin.source} error={errors.source?.message}>
          <input
            {...register("source")}
            className="input-cls"
            placeholder="e.g. Minna no Nihongo Ch.1"
          />
        </Field>
      </div>

      <Field
        label={t.admin.description}
        className="mt-4"
        error={errors.description?.message}
      >
        <textarea
          {...register("description")}
          rows={2}
          className="input-cls"
          placeholder={t.admin.descriptionPlaceholder}
        />
      </Field>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Section 6: EditorRouter (type switch)
   ══════════════════════════════════════════════════════════════ */

function EditorRouter({
  type,
  content,
  onChange,
  language,
  level,
}: {
  type: LessonType;
  content: LessonContent;
  onChange: (c: LessonContent) => void;
  language: LessonLanguage;
  level: string;
}) {
  switch (type) {
    case "grammar":
      return <GrammarEditor content={content as GrammarContent} onChange={onChange} />;
    case "translation":
      return <TranslationEditor content={content as TranslationContent} onChange={onChange} />;
    case "reading":
      return <ReadingEditor content={content as ReadingContent} onChange={onChange} />;
    case "vocabulary":
      return <VocabularyEditor content={content as VocabularyContent} onChange={onChange} />;
    case "listening":
      return (
        <ListeningEditor
          content={content as ListeningContent}
          onChange={onChange}
          language={language}
          level={level}
        />
      );
  }
}

/* ══════════════════════════════════════════════════════════════
   Section 7: Type-specific content editors
   ══════════════════════════════════════════════════════════════ */

/* ── Grammar ───────────────────────────────────────────────── */
function GrammarEditor({
  content,
  onChange,
}: {
  content: GrammarContent;
  onChange: (c: GrammarContent) => void;
}) {
  const { t } = useLanguageStore();
  const set = <K extends keyof GrammarContent>(k: K, v: GrammarContent[K]) =>
    onChange({ ...content, [k]: v });

  return (
    <div className="space-y-5">
      <Field label={t.admin.formula}>
        <input
          value={content.formula}
          onChange={(e) => set("formula", e.target.value)}
          className="input-cls font-mono"
          placeholder="S + V + O"
        />
      </Field>
      <Field label={t.admin.explanation}>
        <textarea
          value={content.explanation}
          onChange={(e) => set("explanation", e.target.value)}
          rows={5}
          className="input-cls"
          placeholder={t.admin.explanationPlaceholder}
        />
      </Field>

      {/* Examples */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.examples}</span>
          <BtnAdd
            onClick={() =>
              set("examples", [...content.examples, { native: "", vi: "" }])
            }
          />
        </div>
        {content.examples.map((ex, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input
              value={ex.native}
              onChange={(e) => {
                const arr = [...content.examples];
                arr[i] = { ...arr[i], native: e.target.value };
                set("examples", arr);
              }}
              className="input-cls flex-1"
              placeholder={t.admin.exampleOriginalPlaceholder}
            />
            <input
              value={ex.vi}
              onChange={(e) => {
                const arr = [...content.examples];
                arr[i] = { ...arr[i], vi: e.target.value };
                set("examples", arr);
              }}
              className="input-cls flex-1"
              placeholder={t.admin.exampleViPlaceholder}
            />
            <BtnRemove
              onClick={() =>
                set(
                  "examples",
                  content.examples.filter((_, j) => j !== i),
                )
              }
            />
          </div>
        ))}
      </div>

      {/* Exercises */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.exercises}</span>
          <BtnAdd
            label={t.admin.addQuestion}
            onClick={() =>
              set("exercises", [
                ...content.exercises,
                {
                  question: "",
                  options: ["", "", "", ""],
                  correct: 0,
                  explanation: "",
                },
              ])
            }
          />
        </div>
        {content.exercises.map((ex, i) => (
          <div key={i} className="mb-4 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold text-muted-foreground">
                {t.admin.questionN} {i + 1}
              </span>
              <BtnRemove
                onClick={() =>
                  set(
                    "exercises",
                    content.exercises.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
            <input
              value={ex.question}
              onChange={(e) => {
                const arr = [...content.exercises];
                arr[i] = { ...arr[i], question: e.target.value };
                set("exercises", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.questionPlaceholder}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ex.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`ex-${i}`}
                    checked={ex.correct === oi}
                    onChange={() => {
                      const arr = [...content.exercises];
                      arr[i] = { ...arr[i], correct: oi };
                      set("exercises", arr);
                    }}
                    className="accent-primary"
                  />
                  <input
                    value={opt}
                    onChange={(e) => {
                      const arr = [...content.exercises];
                      const opts = [...arr[i].options];
                      opts[oi] = e.target.value;
                      arr[i] = { ...arr[i], options: opts };
                      set("exercises", arr);
                    }}
                    className="input-cls flex-1"
                    placeholder={`${t.admin.answerN} ${oi + 1}`}
                  />
                </div>
              ))}
            </div>
            <input
              value={ex.explanation}
              onChange={(e) => {
                const arr = [...content.exercises];
                arr[i] = { ...arr[i], explanation: e.target.value };
                set("exercises", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.answerExplanationPlaceholder}
            />
          </div>
        ))}
      </div>

      {/* Tips */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.tips}</span>
          <BtnAdd onClick={() => set("tips", [...content.tips, ""])} />
        </div>
        {content.tips.map((tip, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input
              value={tip}
              onChange={(e) => {
                const arr = [...content.tips];
                arr[i] = e.target.value;
                set("tips", arr);
              }}
              className="input-cls flex-1"
              placeholder={t.admin.tipPlaceholder}
            />
            <BtnRemove
              onClick={() =>
                set(
                  "tips",
                  content.tips.filter((_, j) => j !== i),
                )
              }
            />
          </div>
        ))}
      </div>

      {/* Common Mistakes */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.commonMistakes}</span>
          <BtnAdd
            onClick={() =>
              set("commonMistakes", [
                ...content.commonMistakes,
                { wrong: "", right: "", note: "" },
              ])
            }
          />
        </div>
        {content.commonMistakes.map((m, i) => (
          <div key={i} className="mb-2 grid grid-cols-3 gap-2">
            <input
              value={m.wrong}
              onChange={(e) => {
                const arr = [...content.commonMistakes];
                arr[i] = { ...arr[i], wrong: e.target.value };
                set("commonMistakes", arr);
              }}
              className="input-cls text-red-600"
              placeholder={t.admin.mistakeWrongPlaceholder}
            />
            <input
              value={m.right}
              onChange={(e) => {
                const arr = [...content.commonMistakes];
                arr[i] = { ...arr[i], right: e.target.value };
                set("commonMistakes", arr);
              }}
              className="input-cls text-green-600"
              placeholder={t.admin.mistakeRightPlaceholder}
            />
            <div className="flex gap-2">
              <input
                value={m.note}
                onChange={(e) => {
                  const arr = [...content.commonMistakes];
                  arr[i] = { ...arr[i], note: e.target.value };
                  set("commonMistakes", arr);
                }}
                className="input-cls flex-1"
                placeholder={t.admin.mistakeNotePlaceholder}
              />
              <BtnRemove
                onClick={() =>
                  set(
                    "commonMistakes",
                    content.commonMistakes.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Translation ───────────────────────────────────────────── */
function TranslationEditor({
  content,
  onChange,
}: {
  content: TranslationContent;
  onChange: (c: TranslationContent) => void;
}) {
  const { t } = useLanguageStore();
  const set = (sentences: TranslationContent["sentences"]) =>
    onChange({ sentences });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t.admin.translationSentences}</span>
        <BtnAdd
          onClick={() =>
            set([
              ...content.sentences,
              { id: content.sentences.length + 1, vi: "", target: "" },
            ])
          }
        />
      </div>
      {content.sentences.map((s, i) => (
        <div key={i} className="flex gap-2">
          <span className="mt-2 text-xs font-bold text-muted-foreground">
            {i + 1}
          </span>
          <div className="flex-1 space-y-1">
            <input
              value={s.vi}
              onChange={(e) => {
                const arr = [...content.sentences];
                arr[i] = { ...arr[i], vi: e.target.value };
                set(arr);
              }}
              className="input-cls"
              placeholder={t.admin.exampleViPlaceholder}
            />
            <input
              value={s.target}
              onChange={(e) => {
                const arr = [...content.sentences];
                arr[i] = { ...arr[i], target: e.target.value };
                set(arr);
              }}
              className="input-cls"
              placeholder={t.admin.exampleOriginalPlaceholder}
            />
            <input
              value={s.hint ?? ""}
              onChange={(e) => {
                const arr = [...content.sentences];
                arr[i] = { ...arr[i], hint: e.target.value || undefined };
                set(arr);
              }}
              className="input-cls text-xs"
              placeholder={t.admin.hintPlaceholder}
            />
          </div>
          <BtnRemove
            onClick={() => set(content.sentences.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Reading ───────────────────────────────────────────────── */
function ReadingEditor({
  content,
  onChange,
}: {
  content: ReadingContent;
  onChange: (c: ReadingContent) => void;
}) {
  const { t } = useLanguageStore();
  const set = <K extends keyof ReadingContent>(k: K, v: ReadingContent[K]) =>
    onChange({ ...content, [k]: v });

  return (
    <div className="space-y-5">
      <Field label={t.admin.lessonContent}>
        <textarea
          value={content.text}
          onChange={(e) => {
            set("text", e.target.value);
            set(
              "wordCount",
              e.target.value.length > 0
                ? e.target.value.split(/\s+/).length
                : 0,
            );
          }}
          rows={10}
          className="input-cls"
          placeholder={t.admin.readingContentPlaceholder}
        />
        <span className="text-xs text-muted-foreground">
          {content.wordCount} {t.admin.wordsCountSuffix}
        </span>
      </Field>

      {/* Vocabulary */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.vocabulary}</span>
          <BtnAdd
            label={t.admin.addVocab}
            onClick={() =>
              set("vocabulary", [
                ...content.vocabulary,
                {
                  word: "",
                  definition: "",
                  definitionVi: "",
                  partOfSpeech: "noun",
                  example: "",
                },
              ])
            }
          />
        </div>
        {content.vocabulary.map((v, i) => (
          <div key={i} className="mb-2 grid grid-cols-5 gap-2">
            <input
              value={v.word}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], word: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.word}
            />
            <input
              value={v.reading ?? ""}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], reading: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.pronunciation}
            />
            <input
              value={v.definition}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], definition: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.definition}
            />
            <input
              value={v.definitionVi}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], definitionVi: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.definitionVi}
            />
            <div className="flex gap-1">
              <input
                value={v.example}
                onChange={(e) => {
                  const arr = [...content.vocabulary];
                  arr[i] = { ...arr[i], example: e.target.value };
                  set("vocabulary", arr);
                }}
                className="input-cls flex-1"
                placeholder={t.admin.examples}
              />
              <BtnRemove
                onClick={() =>
                  set(
                    "vocabulary",
                    content.vocabulary.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>

      {/* Questions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.comprehensionQuestions}</span>
          <BtnAdd
            label={t.admin.addQuestion}
            onClick={() =>
              set("questions", [
                ...content.questions,
                {
                  question: "",
                  questionVi: "",
                  options: ["", "", "", ""],
                  correctAnswer: 0,
                  explanation: "",
                },
              ])
            }
          />
        </div>
        {content.questions.map((q, i) => (
          <div key={i} className="mb-4 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold text-muted-foreground">
                {t.admin.questionN} {i + 1}
              </span>
              <BtnRemove
                onClick={() =>
                  set(
                    "questions",
                    content.questions.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
            <input
              value={q.question}
              onChange={(e) => {
                const arr = [...content.questions];
                arr[i] = { ...arr[i], question: e.target.value };
                set("questions", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.questionPlaceholder}
            />
            <input
              value={q.questionVi ?? ""}
              onChange={(e) => {
                const arr = [...content.questions];
                arr[i] = { ...arr[i], questionVi: e.target.value };
                set("questions", arr);
              }}
              className="input-cls mt-1"
              placeholder={`${t.admin.questionPlaceholder} (VI)`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`rq-${i}`}
                    checked={q.correctAnswer === oi}
                    onChange={() => {
                      const arr = [...content.questions];
                      arr[i] = { ...arr[i], correctAnswer: oi };
                      set("questions", arr);
                    }}
                    className="accent-primary"
                  />
                  <input
                    value={opt}
                    onChange={(e) => {
                      const arr = [...content.questions];
                      const opts = [...arr[i].options];
                      opts[oi] = e.target.value;
                      arr[i] = { ...arr[i], options: opts };
                      set("questions", arr);
                    }}
                    className="input-cls flex-1"
                    placeholder={`${t.admin.answerN} ${oi + 1}`}
                  />
                </div>
              ))}
            </div>
            <input
              value={q.explanation}
              onChange={(e) => {
                const arr = [...content.questions];
                arr[i] = { ...arr[i], explanation: e.target.value };
                set("questions", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.answerExplanationPlaceholder}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Vocabulary ────────────────────────────────────────────── */
function VocabularyEditor({
  content,
  onChange,
}: {
  content: VocabularyContent;
  onChange: (c: VocabularyContent) => void;
}) {
  const { t } = useLanguageStore();
  const setWords = (words: VocabularyContent["words"]) =>
    onChange({ ...content, words });

  return (
    <div className="space-y-4">
      <Field label={t.admin.themeColor}>
        <input
          type="color"
          value={content.color ?? "#3b82f6"}
          onChange={(e) => onChange({ ...content, color: e.target.value })}
          className="h-10 w-20 rounded border border-border"
        />
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {t.admin.vocabulary} ({content.words.length})
        </span>
        <BtnAdd
          label={t.admin.addVocab}
          onClick={() =>
            setWords([
              ...content.words,
              { word: "", pos: "noun", en: "", vi: "", example: "", topic: "" },
            ])
          }
        />
      </div>

      <div className="max-h-125 space-y-2 overflow-y-auto pr-1">
        {content.words.map((w, i) => (
          <div
            key={i}
            className="grid grid-cols-6 gap-2 rounded-lg border border-border p-2"
          >
            <input
              value={w.word}
              onChange={(e) => {
                const arr = [...content.words];
                arr[i] = { ...arr[i], word: e.target.value };
                setWords(arr);
              }}
              className="input-cls"
              placeholder={t.admin.word}
            />
            <input
              value={w.reading ?? w.pinyin ?? w.ipa ?? ""}
              onChange={(e) => {
                const arr = [...content.words];
                arr[i] = {
                  ...arr[i],
                  reading: e.target.value,
                  pinyin: e.target.value,
                  ipa: e.target.value,
                };
                setWords(arr);
              }}
              className="input-cls"
              placeholder={t.admin.pronunciation}
            />
            <select
              value={w.pos}
              onChange={(e) => {
                const arr = [...content.words];
                arr[i] = { ...arr[i], pos: e.target.value };
                setWords(arr);
              }}
              className="input-cls"
            >
              <option value="noun">{t.admin.posNoun}</option>
              <option value="verb">{t.admin.posVerb}</option>
              <option value="adjective">{t.admin.posAdjective}</option>
              <option value="adverb">{t.admin.posAdverb}</option>
              <option value="phrase">{t.admin.posPhrase}</option>
              <option value="particle">{t.admin.posParticle}</option>
            </select>
            <input
              value={w.en}
              onChange={(e) => {
                const arr = [...content.words];
                arr[i] = { ...arr[i], en: e.target.value };
                setWords(arr);
              }}
              className="input-cls"
              placeholder={t.admin.definition}
            />
            <input
              value={w.vi}
              onChange={(e) => {
                const arr = [...content.words];
                arr[i] = { ...arr[i], vi: e.target.value };
                setWords(arr);
              }}
              className="input-cls"
              placeholder={t.admin.definitionVi}
            />
            <div className="flex gap-1">
              <input
                value={w.example}
                onChange={(e) => {
                  const arr = [...content.words];
                  arr[i] = { ...arr[i], example: e.target.value };
                  setWords(arr);
                }}
                className="input-cls flex-1"
                placeholder={t.admin.examples}
              />
              <BtnRemove
                onClick={() =>
                  setWords(content.words.filter((_, j) => j !== i))
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Listening ─────────────────────────────────────────────── */
function ListeningEditor({
  content,
  onChange,
  language,
  level,
}: {
  content: ListeningContent;
  onChange: (c: ListeningContent) => void;
  language: string;
  level: string;
}) {
  const set = <K extends keyof ListeningContent>(
    k: K,
    v: ListeningContent[K],
  ) => onChange({ ...content, [k]: v });
  const { t } = useLanguageStore();

  const [aiGenerating, setAiGenerating] = useState(false);
  // AI-generated content is staged for explicit confirmation so it never
  // silently overwrites user-edited vocabulary/questions (draft preservation).
  const [stagedGeneration, setStagedGeneration] = useState<{
    vocabulary: ListeningContent["vocabulary"];
    questions: ListeningContent["questions"];
  } | null>(null);

  const handleAiGenerate = async () => {
    if (!content.transcript.trim()) return;
    setAiGenerating(true);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/cms/lessons/generate-from-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          transcript: content.transcript,
          language,
          level,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || t.admin.aiGenerationError);
        return;
      }

      const json = await res.json();
      const { data } = json;
      if (data) {
        setStagedGeneration({
          vocabulary: data.vocabulary || [],
          questions: data.questions || [],
        });
        toast.success(t.admin.aiGenerateSuccess);
      }
    } catch {
      toast.error(t.admin.aiGenerationError);
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label={t.admin.audioFile}>
          <AudioUpload
            value={content.audioUrl ?? ""}
            onChange={(url) => set("audioUrl", normalizeUploadUrl(url))}
          />
        </Field>
        <Field label={t.admin.duration}>
          <input
            value={content.duration}
            onChange={(e) => set("duration", e.target.value)}
            className="input-cls"
            placeholder="e.g. 2-3 min"
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-foreground">
            {t.admin.transcript}
          </label>
          <button
            type="button"
            onClick={handleAiGenerate}
            disabled={aiGenerating || !content.transcript.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-55"
          >
            {aiGenerating ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t.admin.aiGenerating}
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                {t.admin.aiGenerate}
              </>
            )}
          </button>
        </div>
        <textarea
          value={content.transcript}
          onChange={(e) => set("transcript", e.target.value)}
          rows={8}
          className="input-cls w-full"
          placeholder={t.admin.transcriptPlaceholder}
        />
      </div>

      {/* AI generation confirmation */}
      {stagedGeneration && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          <span>
            {t.admin.aiGenerateSuccess} — {stagedGeneration.vocabulary.length}{" "}
            {t.admin.vocabulary.toLowerCase()}, {stagedGeneration.questions.length}{" "}
            {t.admin.listeningQuestions.toLowerCase()}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1 text-xs font-medium hover:bg-muted"
              onClick={() => setStagedGeneration(null)}
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
              onClick={() => {
                onChange({
                  ...content,
                  vocabulary: stagedGeneration.vocabulary,
                  questions: stagedGeneration.questions,
                });
                setStagedGeneration(null);
              }}
            >
              {t.admin.saveLesson}
            </button>
          </div>
        </div>
      )}

      {/* Vocabulary */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.vocabulary}</span>
          <BtnAdd
            label={t.admin.addVocab}
            onClick={() =>
              set("vocabulary", [
                ...content.vocabulary,
                { word: "", definition: "", definitionVi: "" },
              ])
            }
          />
        </div>
        {content.vocabulary.map((v, i) => (
          <div key={i} className="mb-2 grid grid-cols-3 gap-2">
            <input
              value={v.word}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], word: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.word}
            />
            <input
              value={v.definition}
              onChange={(e) => {
                const arr = [...content.vocabulary];
                arr[i] = { ...arr[i], definition: e.target.value };
                set("vocabulary", arr);
              }}
              className="input-cls"
              placeholder={t.admin.definition}
            />
            <div className="flex gap-1">
              <input
                value={v.definitionVi}
                onChange={(e) => {
                  const arr = [...content.vocabulary];
                  arr[i] = { ...arr[i], definitionVi: e.target.value };
                  set("vocabulary", arr);
                }}
                className="input-cls flex-1"
                placeholder={t.admin.definitionVi}
              />
              <BtnRemove
                onClick={() =>
                  set(
                    "vocabulary",
                    content.vocabulary.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>

      {/* Comprehension Questions */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t.admin.listeningQuestions}</span>
          <BtnAdd
            label={t.admin.addQuestion}
            onClick={() =>
              set("questions", [
                ...content.questions,
                {
                  question: "",
                  options: ["", "", "", ""],
                  correctAnswer: 0,
                  explanation: "",
                },
              ])
            }
          />
        </div>
        {content.questions.map((q, i) => (
          <div key={i} className="mb-4 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs font-bold text-muted-foreground">
                {t.admin.questionN} {i + 1}
              </span>
              <BtnRemove
                onClick={() =>
                  set(
                    "questions",
                    content.questions.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
            <input
              value={q.question}
              onChange={(e) => {
                const arr = [...content.questions];
                arr[i] = { ...arr[i], question: e.target.value };
                set("questions", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.questionPlaceholder}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`lq-${i}`}
                    checked={q.correctAnswer === oi}
                    onChange={() => {
                      const arr = [...content.questions];
                      arr[i] = { ...arr[i], correctAnswer: oi };
                      set("questions", arr);
                    }}
                    className="accent-primary"
                  />
                  <input
                    value={opt}
                    onChange={(e) => {
                      const arr = [...content.questions];
                      const opts = [...arr[i].options];
                      opts[oi] = e.target.value;
                      arr[i] = { ...arr[i], options: opts };
                      set("questions", arr);
                    }}
                    className="input-cls flex-1"
                    placeholder={`${t.admin.answerN} ${oi + 1}`}
                  />
                </div>
              ))}
            </div>
            <input
              value={q.explanation}
              onChange={(e) => {
                const arr = [...content.questions];
                arr[i] = { ...arr[i], explanation: e.target.value };
                set("questions", arr);
              }}
              className="input-cls mt-2"
              placeholder={t.admin.answerExplanationPlaceholder}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
