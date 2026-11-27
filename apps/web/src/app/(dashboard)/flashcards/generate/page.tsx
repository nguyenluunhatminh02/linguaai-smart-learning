'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  ArrowLeft,
  Upload,
  FileText,
  Loader2,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Languages,
  Layers,
  ChevronRight
} from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

const LANGUAGE_OPTIONS = [
  { value: 'english', label: 'Tiếng Anh (English)' },
  { value: 'vietnamese', label: 'Tiếng Việt (Vietnamese)' },
  { value: 'japanese', label: 'Tiếng Nhật (Japanese)' },
  { value: 'korean', label: 'Tiếng Hàn (Korean)' },
  { value: 'chinese', label: 'Tiếng Trung (Chinese)' },
  { value: 'spanish', label: 'Tiếng Tây Ban Nha (Spanish)' },
  { value: 'french', label: 'Tiếng Pháp (French)' },
  { value: 'german', label: 'Tiếng Đức (German)' },
];

const CARD_COUNTS = [5, 10, 15, 20];

type LoadingStep = 'idle' | 'creating_deck' | 'generating_cards' | 'redirecting' | 'error';

export default function AIFlashcardGeneratorPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('english');
  const [count, setCount] = useState(10);

  // File states
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loading/Progress states
  const [step, setStep] = useState<LoadingStep>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read file contents
  const handleFileRead = (file: File) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.txt') && !file.name.toLowerCase().endsWith('.md')) {
      setErrorMsg('Vui lòng chỉ tải lên tệp văn bản .txt hoặc .md');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Tệp văn bản không được vượt quá 5MB.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setErrorMsg(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content !== 'string' || !content.trim()) {
        setFileName(null);
        setErrorMsg('Không thể đọc nội dung tệp. Vui lòng tải lên tệp văn bản UTF-8 hợp lệ.');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      setText(content);
    };
    reader.onerror = () => {
      setFileName(null);
      setErrorMsg('Đã xảy ra lỗi khi đọc tệp.');
    };
    reader.readAsText(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }, []);

  const clearFile = () => {
    setFileName(null);
    setText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Submit flow
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sourceText = text.trim();

    if (!sourceText) {
      setErrorMsg('Vui lòng nhập đoạn văn hoặc tải lên một tệp văn bản.');
      return;
    }

    setErrorMsg(null);
    setStep('creating_deck');
    setProgress(20);
    let createdDeckId: string | undefined;

    try {
      // Step 1: Create Deck
      const deckTitle = title.trim() || `Bộ thẻ AI - ${new Date().toLocaleDateString('vi-VN')}`;
      const deckDescription = description.trim() || `Từ vựng được trích xuất tự động từ văn bản bởi AI.`;

      const deckResponse = await apiClient.post('/decks', {
        title: deckTitle,
        description: deckDescription,
        language: language,
      });

      const deck = deckResponse.data as { id?: string } | undefined;
      const deckId = deck?.id;

      if (!deckId) {
        throw new Error('Không nhận được ID bộ thẻ từ máy chủ.');
      }
      createdDeckId = deckId;

      // Step 2: Generate Cards from Text
      setStep('generating_cards');
      setProgress(50);

      await apiClient.post(`/decks/${deckId}/cards/generate-from-text`, {
        text: sourceText,
        language: language,
        count: count,
      });

      createdDeckId = undefined;
      // Step 3: Redirecting
      setStep('redirecting');
      setProgress(90);

      // Invalidate queries or wait briefly for smooth visual feedback
      setTimeout(() => {
        setProgress(100);
        router.push(`/flashcards/${deckId}`);
      }, 800);

    } catch (err: unknown) {
      console.error(err);
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      if (createdDeckId) {
        try {
          // Do not leave an empty deck behind when card generation fails.
          await apiClient.delete(`/decks/${createdDeckId}`);
          void queryClient.invalidateQueries({ queryKey: ['decks'] });
        } catch (cleanupError) {
          console.error('Failed to remove empty deck after generation error', cleanupError);
        }
      }
      setErrorMsg(
        error.response?.data?.message ||
        error.message ||
        'Đã xảy ra lỗi khi tạo bộ thẻ bằng AI. Vui lòng thử lại.'
      );
      setStep('idle');
      setProgress(0);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between">
        <Link href="/flashcards">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Quay lại danh sách
          </Button>
        </Link>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Thẻ ghi nhớ</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Tạo từ vựng bằng AI</span>
        </div>
      </div>

      {/* Header Title */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 dark:bg-primary/20 text-primary-dark dark:text-primary-light">
          <Sparkles className="h-6 w-6 animate-pulse" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gradient-start via-gradient-mid to-gradient-end">
            AI Vocabulary Generator
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tự động trích xuất từ vựng từ tệp tin hoặc bài viết bất kỳ và tạo thành bộ Flashcard trong tích tắc.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main form */}
        <div className="md:col-span-2">
          <Card className="border-primary/20 dark:border-primary/10 shadow-sm overflow-hidden">
            <CardHeader className="bg-linear-to-br from-primary/5 to-primary-light/5 dark:from-primary/10 dark:to-primary-light/5 border-b border-border/40">
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-primary-dark dark:text-primary-light">
                <FileText className="h-5 w-5" /> Nguồn tài liệu học tập
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {/* Paste Text area */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground flex justify-between">
                  <span>Dán nội dung đoạn văn, tin tức, bài báo...</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {text.length} ký tự
                  </span>
                </label>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (fileName) setFileName(null); // Clear file name if manually edited
                  }}
                  placeholder="Dán văn bản cần học từ vựng vào đây..."
                  className="w-full min-h-60 rounded-2xl border border-border bg-background px-4 py-3.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/50 resize-y"
                  disabled={step !== 'idle'}
                />
              </div>

              {/* Or separator */}
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-border"></div>
                <span className="flex-shrink mx-4 text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest bg-background px-2">Hoặc</span>
                <div className="flex-grow border-t border-border"></div>
              </div>

              {/* File Upload zone */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  Tải lên tệp tin văn bản (.txt, .md)
                </label>
                
                {fileName ? (
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-primary/5 dark:bg-primary/15 border border-primary/20 dark:border-primary/15">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-primary/10 rounded-xl text-primary-dark dark:text-primary-light">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground truncate max-w-[200px] sm:max-w-sm">
                          {fileName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Nội dung đã được tải vào khung nhập văn bản.
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearFile} className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl">
                      Xóa tệp
                    </Button>
                  </div>
                ) : (
                  <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center ${
                      isDragging
                        ? 'border-primary bg-primary/10 dark:bg-primary/10 scale-[0.99]'
                        : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-primary/5 dark:hover:bg-primary/5'
                    }`}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={onFileChange}
                      accept=".txt,.md"
                      className="hidden"
                    />
                    <div className="p-3 bg-muted rounded-2xl text-muted-foreground mb-3 group-hover:text-primary transition-colors">
                      <Upload className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-bold text-foreground">
                      Kéo thả tệp tin hoặc nhấp vào đây để chọn tệp
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Hỗ trợ định dạng .txt, .md (Kích thước tối đa 5MB)
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Configuration Panel */}
        <div className="space-y-6">
          <Card className="border-primary/20 dark:border-primary/10 shadow-sm overflow-hidden">
            <CardHeader className="bg-linear-to-br from-primary/5 to-primary-light/5 dark:from-primary/10 dark:to-primary-light/5 border-b border-border/40">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-primary-dark dark:text-primary-light">
                <Languages className="h-4 w-4" /> Cấu hình bộ thẻ AI
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              {/* Target language */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngôn ngữ mục tiêu</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  disabled={step !== 'idle'}
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Card count */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Số lượng từ vựng cần trích xuất</label>
                <div className="grid grid-cols-4 gap-2">
                  {CARD_COUNTS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setCount(cnt)}
                      className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                        count === cnt
                          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                          : 'bg-background hover:bg-muted/50 border-border text-foreground'
                      }`}
                      disabled={step !== 'idle'}
                    >
                      {cnt} từ
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border my-2"></div>

              {/* Title & Description metadata */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tên bộ thẻ (Tùy chọn)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: Từ vựng Bài báo Khoa học"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/40"
                  disabled={step !== 'idle'}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mô tả bộ thẻ (Tùy chọn)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ví dụ: Các từ vựng chủ đề môi trường..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground/40"
                  disabled={step !== 'idle'}
                />
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl border border-red-200 bg-red-50 dark:border-red-950/20 dark:bg-red-950/10 flex items-start gap-2 text-xs font-medium text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>{errorMsg}</div>
                </div>
              )}

              {/* Submit Button */}
              <Button
                variant="gradient"
                size="lg"
                onClick={handleSubmit}
                disabled={step !== 'idle' || !text.trim()}
                className="w-full gap-2 text-sm rounded-xl h-11 shadow-md"
              >
                <Sparkles className="h-4 w-4" /> Tạo bộ thẻ bằng AI
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Glassmorphism Loading Overlay */}
      {step !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="max-w-md w-full mx-4 p-8 rounded-3xl bg-card border shadow-2xl space-y-6 text-center">
            <div className="relative flex justify-center">
              <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping w-16 h-16 mx-auto" />
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-primary-light">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-extrabold text-foreground">
                {step === 'creating_deck' && 'Đang tạo bộ thẻ...'}
                {step === 'generating_cards' && 'Đang trích xuất từ vựng bằng AI...'}
                {step === 'redirecting' && 'Đã hoàn thành! Đang chuẩn bị hiển thị...'}
              </h3>
              <p className="text-sm text-muted-foreground px-4">
                {step === 'creating_deck' && 'Khởi tạo thư mục bộ thẻ ghi nhớ mới trong tài khoản của bạn.'}
                {step === 'generating_cards' && 'AI đang phân tích văn bản, chọn lọc các từ khóa quan quan trọng, phiên âm IPA, định nghĩa và viết ví dụ minh họa.'}
                {step === 'redirecting' && 'Lưu bộ thẻ thành công. Đang chuyển hướng bạn đến trang học tập.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground px-1 font-semibold">
                <span>Tiến độ</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2 rounded-full" />
            </div>

            <div className="flex items-center justify-center gap-1.5 text-xs text-primary dark:text-primary-light font-medium">
              <Layers className="h-3.5 w-3.5" /> Chế độ FSRS-4.5 • AI cục bộ
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
