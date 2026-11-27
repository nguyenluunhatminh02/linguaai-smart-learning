"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  BookOpen,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  MessageSquare,
  LayoutList,
  BookText,
  Headphones,
} from "lucide-react";
import type { CmsLesson, LessonType, LessonLanguage } from "@/lib/types/cms";
import { FlagIcon } from "@/components/ui/flag-icon";
import { useLanguageStore } from "@/stores/language-store";
import { getAccessToken } from "@/stores/auth-store";

const TYPE_ICON: Record<LessonType, React.ReactNode> = {
  grammar: <BookText className="h-4 w-4" />,
  translation: <MessageSquare className="h-4 w-4" />,
  reading: <FileText className="h-4 w-4" />,
  vocabulary: <LayoutList className="h-4 w-4" />,
  listening: <Headphones className="h-4 w-4" />,
};

const LANG_FLAG: Record<LessonLanguage, React.ReactNode> = {
  english: <FlagIcon country="english" className="h-4.5 w-6 rounded-xs shadow-xs border border-border/10 inline-block align-middle" />,
  chinese: <FlagIcon country="chinese" className="h-4.5 w-6 rounded-xs shadow-xs border border-border/10 inline-block align-middle" />,
  japanese: <FlagIcon country="japanese" className="h-4.5 w-6 rounded-xs shadow-xs border border-border/10 inline-block align-middle" />,
};

export default function AdminLessonsPage() {
  const { t } = useLanguageStore();
  const searchParams = useSearchParams();
  const [lessons, setLessons] = useState<CmsLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [langFilter, setLangFilter] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({
    total: 0,
    totalPages: 1,
    page: 1,
    limit: 20,
  });
  const PAGE_SIZE = 20;

  const typeLabels: Record<LessonType, string> = {
    grammar: t.admin.typeGrammar,
    translation: t.admin.typeTranslation,
    reading: t.admin.typeReading,
    vocabulary: t.admin.typeVocabulary,
    listening: t.admin.typeListening,
  };

  const fetchLessons = async (p = page) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    if (langFilter) params.set("language", langFilter);
    params.set("page", String(p));
    params.set("limit", String(PAGE_SIZE));

    try {
      const res = await fetch(`/api/cms/lessons?${params}`);
      const json = await res.json();
      if (json.data && json.meta) {
        setLessons(json.data);
        setMeta(json.meta);
      } else if (Array.isArray(json)) {
        setLessons(json);
        setMeta({
          total: json.length,
          totalPages: 1,
          page: 1,
          limit: json.length,
        });
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  useEffect(() => {
    setPage(1);
    fetchLessons(1);
  }, [typeFilter, langFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchLessons(page);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLessons(1);
  };

  const handleDelete = async (id: string, title: string) => {
    const confirmMsg = t.admin.deleteConfirm.replace("{title}", title);
    if (!confirm(confirmMsg))
      return;
    setDeletingId(id);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/cms/lessons/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        await fetchLessons(page);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const stats = {
    total: meta.total,
    published: lessons.filter((l) => l.isPublished).length,
    draft: lessons.filter((l) => !l.isPublished).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t.admin.lessonsList}</h2>
          <p className="text-sm text-muted-foreground">
            {t.admin.lessonsListDesc}
          </p>
        </div>
        <Link
          href="/admin/lessons/new"
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> {t.admin.createLesson}
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={<BookOpen className="h-5 w-5 text-primary" />}
          label={t.admin.totalLessonsTitle}
          value={stats.total}
        />
        <StatCard
          icon={<Eye className="h-5 w-5 text-green-500" />}
          label={t.admin.publishedTitle}
          value={stats.published}
        />
        <StatCard
          icon={<EyeOff className="h-5 w-5 text-amber-500" />}
          label={t.admin.draftTitle}
          value={stats.draft}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="relative flex-1">
          <label htmlFor="lesson-search" className="sr-only">
            {t.admin.searchLessons}
          </label>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="lesson-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.admin.searchLessonsPlaceholder}
            className="input-cls pl-10"
            aria-label={t.admin.searchLessonsPlaceholder}
          />
        </form>

        <label htmlFor="type-filter" className="sr-only">
          {t.admin.filterByType}
        </label>
        <select
          id="type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="input-cls w-40"
          aria-label={t.admin.filterByType}
        >
          <option value="">{t.admin.allTypes}</option>
          <option value="grammar">{t.admin.typeGrammar}</option>
          <option value="translation">{t.admin.typeTranslation}</option>
          <option value="reading">{t.admin.typeReading}</option>
          <option value="vocabulary">{t.admin.typeVocabulary}</option>
          <option value="listening">{t.admin.typeListening}</option>
        </select>

        <label htmlFor="lang-filter" className="sr-only">
          {t.admin.filterByLang}
        </label>
        <select
          id="lang-filter"
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          className="input-cls w-40"
          aria-label={t.admin.filterByLang}
        >
          <option value="">{t.admin.allLanguages}</option>
          <option value="english">{t.admin.langEnglish}</option>
          <option value="chinese">{t.admin.langChinese}</option>
          <option value="japanese">{t.admin.langJapanese}</option>
        </select>
      </div>

      {/* Lesson Table */}
      {loading ? (
        <div className="py-20 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : lessons.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium">{t.admin.noLessonsYet}</p>
            <p className="text-sm text-muted-foreground">
              {t.admin.noLessonsYetDesc}
            </p>
          </div>
          <Link
            href="/admin/lessons/new"
            className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> {t.admin.createFirstLesson}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t.admin.colLesson}</th>
                <th className="px-4 py-3 text-left font-medium">{t.admin.colType}</th>
                <th className="px-4 py-3 text-left font-medium">{t.admin.colLanguage}</th>
                <th className="px-4 py-3 text-left font-medium">{t.admin.colLevel}</th>
                <th className="px-4 py-3 text-left font-medium">{t.admin.colSource}</th>
                <th className="px-4 py-3 text-center font-medium">
                  {t.admin.colStatus}
                </th>
                <th className="px-4 py-3 text-right font-medium">{t.admin.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson) => (
                <tr
                  key={lesson.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {lesson.thumbnail ? (
                        <Image
                          src={lesson.thumbnail}
                          alt=""
                          width={48}
                          height={36}
                          className="h-9 w-12 rounded-lg object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-9 w-12 items-center justify-center rounded-lg bg-muted">
                          {TYPE_ICON[lesson.type]}
                        </div>
                      )}
                      <div>
                        <p className="font-medium leading-tight">
                          {lesson.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {lesson.titleVi}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {TYPE_ICON[lesson.type]} {typeLabels[lesson.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-lg">
                    {LANG_FLAG[lesson.language]}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {lesson.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {lesson.source || "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {lesson.isPublished ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <Eye className="h-3 w-3" /> {t.admin.published}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        <EyeOff className="h-3 w-3" /> {t.admin.draft}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/admin/lessons/${lesson.id}/edit`}
                        className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label={`${t.admin.editLessonTooltip} ${lesson.title}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <button
                        onClick={() => handleDelete(lesson.id, lesson.title)}
                        disabled={deletingId === lesson.id}
                        className="rounded-lg p-2 text-muted-foreground transition hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`${t.admin.deleteLessonTooltip} ${lesson.title}`}
                      >
                        {deletingId === lesson.id ? (
                          <svg
                            className="h-4 w-4 animate-spin"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="text-sm text-muted-foreground">
            {t.admin.paginationInfo
              .replace("{page}", String(meta.page))
              .replace("{totalPages}", String(meta.totalPages))
              .replace("{total}", String(meta.total))}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← {t.common.previous}
            </button>
            {Array.from({ length: Math.min(7, meta.totalPages) }, (_, i) => {
              const half = 3;
              let start = Math.max(1, page - half);
              const end = Math.min(meta.totalPages, start + 6);
              start = Math.max(1, end - 6);
              const p = start + i;
              if (p > meta.totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    p === page
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.common.next} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
