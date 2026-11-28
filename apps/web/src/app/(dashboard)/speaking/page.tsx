'use client';

/**
 * Speaking dashboard page (roadmap FE-12).
 *
 * Composition only: topic setup/selection, mode switch and layout live here.
 * Capture, WebSocket streaming, REST transcription, transcript comparison and
 * score rendering belong to `src/features/speaking/*` and are consumed through
 * their public hooks/components. No microphone, timer, fetch, WebSocket or
 * scoring logic is implemented in this file.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronUp, History, Lightbulb, Loader2, MessageSquare, Mic,
  Sparkles, Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { speakWord } from '@/lib/speech';
import { useLanguageStore } from '@/stores/language-store';
import { useLearningLanguageStore } from '@/stores/learning-language-store';
import { AudioRecorder } from '@/features/speaking/components/AudioRecorder';
import { useSpeakingFeedback } from '@/features/speaking/hooks/use-speaking-feedback';
import {
  compareTranscript, getRecognitionLang,
  getScoreClass, getScoreVariant,
  type TranscriptComparison,
} from '@/features/speaking/utils';
import type { SpeakingMode } from '@/features/speaking/types';

const LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'vietnamese', label: 'Tiếng Việt' },
  { value: 'japanese', label: '日本語' },
  { value: 'korean', label: '한국어' },
  { value: 'chinese', label: '中文' },
  { value: 'spanish', label: 'Español' },
  { value: 'french', label: 'Français' },
  { value: 'german', label: 'Deutsch' },
] as const;

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

const CATEGORIES = [
  { id: 'daily', label: 'Daily Life' },
  { id: 'travel', label: 'Travel' },
  { id: 'work', label: 'Work & Study' },
  { id: 'opinion', label: 'Opinion' },
  { id: 'story', label: 'Storytelling' },
] as const;

const PRESETS = [
  { text: 'The quick brown fox jumps over the lazy dog', label: 'Fox' },
  { text: 'She sells seashells by the seashore', label: 'Seashells' },
  { text: 'How much wood would a woodchuck chuck?', label: 'Woodchuck' },
  { text: 'Chúc bạn một ngày học tập vui vẻ!', label: 'Tiếng Việt' },
  { text: 'こんにちは、はじめまして。', label: 'Tiếng Nhật' },
] as const;

const PIPELINE_STEPS = [
  { label: '🎙️ Record', phases: ['topic', 'recording'] },
  { label: '📡 WebSocket', phases: ['connecting'] },
  { label: '🔊 Whisper STT', phases: ['transcribing'] },
  { label: '🤖 Llama Stream', phases: ['analyzing', 'streaming'] },
  { label: '✨ Typing Effect', phases: ['streaming', 'done'] },
] as const;

function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">Language</p>
      <select
        className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {LANGUAGES.map(({ value: code, label }) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
}

function PipelineSteps({ phase }: { phase: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PIPELINE_STEPS.map(({ label, phases }) => (
        <span
          key={label}
          className={`text-xs rounded-full px-2.5 py-0.5 border transition-colors ${
            (phases as readonly string[]).includes(phase)
              ? 'bg-primary/10 border-primary/30 text-primary font-medium'
              : 'bg-muted/50 border-transparent text-muted-foreground/60'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

export default function SpeakingPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();

  const [mode, setMode] = useState<SpeakingMode>('topic');
  const [level, setLevel] = useState<string>('B1');
  const [category, setCategory] = useState<string>('daily');
  const [targetLanguage, setTargetLanguage] = useState<string>(language || 'english');
  const [targetSentence, setTargetSentence] = useState('The quick brown fox jumps over the lazy dog');
  const [showTips, setShowTips] = useState(true);
  const [coachTranscript, setCoachTranscript] = useState('');
  const [coachComparison, setCoachComparison] = useState<TranscriptComparison>(null);

  const {
    topic, phase, error, isGeneratingTopic, generateTopic, reset: resetFeedback,
  } = useSpeakingFeedback({ level, category, language: targetLanguage });

  useEffect(() => {
    setTargetLanguage(language || 'english');
  }, [language]);

  const handleTranscript = useCallback((text: string) => {
    setCoachTranscript(text);
    if (mode === 'coach') {
      setCoachComparison(
        compareTranscript(targetSentence, text, getRecognitionLang(targetLanguage)),
      );
    }
  }, [mode, targetLanguage, targetSentence]);

  const resetSession = useCallback(() => {
    resetFeedback();
    setCoachTranscript('');
    setCoachComparison(null);
  }, [resetFeedback]);

  const switchMode = useCallback((next: SpeakingMode) => {
    resetSession();
    setMode(next);
  }, [resetSession]);

  const startTopic = useCallback(() => {
    void generateTopic({ level, category, language: targetLanguage });
  }, [category, generateTopic, level, targetLanguage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
            <Mic className="h-5 w-5 text-rose-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.speaking.title}</h1>
            <p className="text-sm text-muted-foreground">{t.speaking.desc}</p>
          </div>
        </div>
        <Link href="/speaking/history">
          <Button variant="outline" size="sm">
            <History className="mr-1.5 h-4 w-4" /> History
          </Button>
        </Link>
      </div>

      <div className="flex gap-2 rounded-xl bg-muted/40 p-1 max-w-sm">
        <button
          onClick={() => switchMode('topic')}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            mode === 'topic'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          🗣️ Luyện nói chủ đề
        </button>
        <button
          onClick={() => switchMode('coach')}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            mode === 'coach'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Luyện nói theo mẫu
        </button>
      </div>

      {mode === 'topic' ? (
        <>
          <PipelineSteps phase={phase} />

          {!topic && (
            <Card>
              <CardContent className="space-y-5 px-6 py-5">
                <LanguageSelect value={targetLanguage} onChange={setTargetLanguage} />
                <div>
                  <p className="mb-2 text-sm font-medium">{t.speaking.selectLevel}</p>
                  <div className="flex flex-wrap gap-2">
                    {LEVELS.map((item) => (
                      <Button
                        key={item}
                        variant={level === item ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setLevel(item)}
                      >
                        {item}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{t.speaking.selectCategory}</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((item) => (
                      <Button
                        key={item.id}
                        variant={category === item.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCategory(item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  variant="gradient"
                  size="lg"
                  onClick={startTopic}
                  disabled={isGeneratingTopic}
                  className="w-full"
                >
                  {isGeneratingTopic ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t.speaking.generating}</>
                  ) : (
                    <><Sparkles className="mr-2 h-5 w-5" />{t.speaking.start}</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {topic && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="space-y-4 px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-bold">{topic.topic}</h2>
                    </div>
                    <p className="mt-1 text-sm text-foreground/80">{topic.prompt}</p>
                  </div>
                  <Badge variant="secondary">{topic.difficulty}</Badge>
                </div>
                {topic.tips.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => setShowTips((value) => !value)}
                    >
                      <Lightbulb className="h-3.5 w-3.5" /> Tips
                      {showTips ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showTips && (
                      <ul className="mt-2 space-y-1.5">
                        {topic.tips.map((item, index) => (
                          <li key={index} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {topic.samplePhrases.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {topic.samplePhrases.map((item, index) => (
                      <Badge
                        key={index}
                        variant="outline"
                        className="cursor-pointer text-xs"
                        onClick={() => speakWord(item)}
                      >
                        <Volume2 className="mr-1 h-3 w-3" />{item}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {topic && (
            <Card>
              <CardContent className="px-6 py-5">
                <AudioRecorder
                  topic={topic}
                  level={level}
                  language={targetLanguage}
                  onReset={resetSession}
                  onTranscript={handleTranscript}
                />
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-4 py-3">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">⚠️ {error.message}</p>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6 animate-fade-in">
          <Card>
            <CardContent className="space-y-5 px-6 py-5">
              <LanguageSelect value={targetLanguage} onChange={setTargetLanguage} />
              <div>
                <p className="mb-2 text-sm font-medium">Câu hoặc đoạn văn cần luyện</p>
                <textarea
                  value={targetSentence}
                  onChange={(event) => setTargetSentence(event.target.value)}
                  placeholder="Nhập câu cần luyện..."
                  className="w-full min-h-20 rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted-foreground">Mẫu:</span>
                  {PRESETS.map((preset) => (
                    <Badge
                      key={preset.label}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary/5 hover:text-primary transition-colors text-xs"
                      onClick={() => setTargetSentence(preset.text)}
                    >
                      {preset.label}
                    </Badge>
                  ))}
                  {topic && topic.samplePhrases.length > 0 && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 transition-colors text-xs"
                      onClick={() => setTargetSentence(topic.samplePhrases[0])}
                    >
                      ✨ Dùng câu từ chủ đề đang học
                    </Badge>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-muted/20 p-5 min-h-24 flex flex-col justify-center">
                {coachComparison && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Kết quả phân tích:
                  </p>
                )}
                <div className="flex flex-wrap gap-x-2 gap-y-3 items-center text-lg font-medium leading-relaxed">
                  {coachComparison ? (
                    coachComparison.diff.map((item, index) => (
                      <span
                        key={index}
                        className={`px-1.5 py-0.5 rounded-md border ${
                          item.status === 'correct'
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400'
                        }`}
                      >
                        {item.word}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground/70">{targetSentence}</span>
                  )}
                </div>
              </div>

              {coachTranscript && (
                <div className="rounded-xl border border-blue-200/50 bg-blue-50/30 p-4 dark:border-blue-900/30 dark:bg-blue-950/10">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
                    🔊 Nội dung nhận diện:
                  </p>
                  <p className="text-sm italic text-foreground/90">&ldquo;{coachTranscript}&rdquo;</p>
                </div>
              )}

              {coachComparison && (
                <Card className="border-primary/20 bg-primary/[0.02] overflow-hidden">
                  <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-center sm:text-left space-y-1">
                      <p className="text-sm text-muted-foreground font-medium">
                        Tỷ lệ từ nhận dạng khớp câu mẫu
                      </p>
                      <h2 className="text-3xl font-extrabold text-foreground flex items-baseline gap-1.5 justify-center sm:justify-start">
                        <span className={getScoreClass(coachComparison.score)}>{coachComparison.score}%</span>
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {coachComparison.score === 100
                          ? 'Hệ thống nhận dạng được đủ từ theo thứ tự trong câu mẫu.'
                          : 'Nghe mẫu rồi thử lại các từ hệ thống chưa nhận dạng được.'}
                      </p>
                    </div>
                    <Progress
                      value={coachComparison.score}
                      variant={getScoreVariant(coachComparison.score)}
                      size="lg"
                      className="w-full sm:max-w-44 shrink-0"
                    />
                  </CardContent>
                </Card>
              )}

              <AudioRecorder
                ref={undefined}
                topic={null}
                level={level}
                language={targetLanguage}
                onTranscript={handleTranscript}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
