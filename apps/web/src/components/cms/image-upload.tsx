"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X, Upload, Loader2 } from "lucide-react";
import Image from "next/image";
import { useLanguageStore } from "@/stores/language-store";
import { getAccessToken } from "@/stores/auth-store";

interface Props {
  /** Current image URL (or empty) */
  value: string;
  /** Called with the URL after a successful upload, or '' on clear */
  onChange: (url: string) => void;
  label?: string;
  /** Max width of the preview */
  className?: string;
}

export function ImageUpload({
  value,
  onChange,
  label,
  className = "",
}: Props) {
  const { t } = useLanguageStore();
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const resolvedLabel = label === undefined ? t.admin.thumbnail : label;

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const token = getAccessToken();
        const res = await fetch("/api/cms/upload", {
          method: "POST",
          headers: token ? {
            "Authorization": `Bearer ${token}`
          } : {},
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error || t.admin.uploadFailed);
          return;
        }
        const data = await res.json();
        onChange(data.url);
      } finally {
        setUploading(false);
      }
    },
    [onChange, t],
  );

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Reset so selecting the same file again still fires a change event
    // (e.g. retrying after a rejected upload).
    e.target.value = '';
    if (f) upload(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  return (
    <div className={className}>
      {resolvedLabel && (
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {resolvedLabel}
        </label>
      )}

      {value ? (
        <div className="group relative inline-block overflow-hidden rounded-xl border border-border">
          <Image
            src={value}
            alt="Preview"
            width={320}
            height={200}
            className="h-auto max-h-48 w-auto max-w-xs object-cover"
            unoptimized
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/40"
          }`}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <ImagePlus className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <span className="text-sm font-medium text-primary">
                  {t.admin.selectImage}
                </span>
                <span className="text-sm text-muted-foreground">
                  {" "}
                  {t.admin.orDragDrop}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.admin.imageFormatLimit}
              </p>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}

/* ── Multi-image upload ─────────────────────────────────────── */

interface MultiProps {
  value: string[];
  onChange: (urls: string[]) => void;
  label?: string;
}

export function MultiImageUpload({
  value,
  onChange,
  label,
}: MultiProps) {
  const { t } = useLanguageStore();
  const [uploading, setUploading] = useState(false);

  const resolvedLabel = label === undefined ? t.admin.lessonImages : label;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getAccessToken();
      const res = await fetch("/api/cms/upload", {
        method: "POST",
        headers: token ? {
          "Authorization": `Bearer ${token}`
        } : {},
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || t.admin.uploadFailed);
        return;
      }
      const data = await res.json();
      onChange([...value, data.url]);
    } finally {
      setUploading(false);
    }
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div>
      {resolvedLabel && (
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {resolvedLabel}
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        {value.map((url, i) => (
          <div
            key={i}
            className="group relative overflow-hidden rounded-lg border border-border"
          >
            <Image
              src={url}
              alt={`Image ${i + 1}`}
              width={120}
              height={80}
              className="h-20 w-28 object-cover"
              unoptimized
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border transition hover:border-primary/50 hover:bg-muted/40">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <>
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t.admin.addImage}</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset so the same image can be added again or retried.
              e.target.value = '';
              if (f) upload(f);
            }}
            className="hidden"
          />
        </label>
      </div>
    </div>
  );
}
