'use client';

import { useRef, useState } from 'react';
import { Music, Upload, X, Loader2 } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';
import { getAccessToken } from '@/stores/auth-store';

interface Props {
  value: string;
  onChange: (url: string) => void;
}

export function AudioUpload({ value, onChange }: Props) {
  const { t } = useLanguageStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getAccessToken();
      const res = await fetch('/api/cms/upload-audio', {
        method: 'POST',
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || t.admin.uploadFailed);
        return;
      }
      onChange(json.url);
    } catch {
      setError(t.admin.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <Music className="h-4 w-4 shrink-0 text-violet-500" />
          <audio controls className="flex-1 h-8" src={value} />
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded p-1 hover:bg-red-100 hover:text-red-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-4 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition disabled:opacity-55"
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t.admin.uploading}</>
          ) : (
            <><Upload className="h-4 w-4" /> {t.admin.selectAudioFile}</>
          )}
        </button>
      )}

      {/* Manual URL input */}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-cls font-mono text-xs"
        placeholder={t.admin.audioUrlPlaceholder}
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/m4a,audio/aac,.mp3,.wav,.ogg,.m4a,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
