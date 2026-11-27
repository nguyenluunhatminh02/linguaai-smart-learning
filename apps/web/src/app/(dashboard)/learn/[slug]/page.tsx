'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Brain, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import type { CommunicationScenario, ScenarioResults } from '@/lib/learning-types';

export default function CommunicationLessonPage() {
  const { slug } = useParams<{ slug: string }>();
  const lesson = useQuery({
    queryKey: ['communication-scenario', slug],
    queryFn: async () => (await apiClient.get<CommunicationScenario>(`/learning/scenarios/${encodeURIComponent(slug)}`)).data,
  });

  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/learn" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Các bài giao tiếp
      </Link>
      {lesson.isPending && <p role="status">Đang tải bài học…</p>}
      {lesson.isError && (
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Chưa mở được bài học</h1>
          <Button onClick={() => void lesson.refetch()}>Tải lại</Button>
        </div>
      )}
      {lesson.data && <ScenarioPractice key={lesson.data.slug} scenario={lesson.data} />}
    </main>
  );
}

function ScenarioPractice({ scenario }: { scenario: CommunicationScenario }) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [answerText, setAnswerText] = useState('');
  const [showModel, setShowModel] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const path = `/learning/scenarios/${scenario.slug}`;

  const complete = useMutation({
    mutationFn: async () => {
      const answerList = scenario.questions.map((_, index) => answers[index]);
      return (await apiClient.post<ScenarioResults>(`${path}/complete`, { answers: answerList })).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['next-learning-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  const savePhrase = useMutation({
    mutationFn: async () => (await apiClient.post<{ deckId: string }>(`${path}/save-phrase`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      void queryClient.invalidateQueries({ queryKey: ['next-learning-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
  const allSelected = Object.keys(answers).length === scenario.questions.length;

  function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allSelected && showModel && !complete.isPending && !complete.isSuccess) complete.mutate();
  }

  return (
    <>
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{scenario.level} · {scenario.estimatedMinutes} phút</p>
        <h1 className="text-2xl font-bold sm:text-3xl">{scenario.title}</h1>
        <p className="text-muted-foreground">{scenario.objective}</p>
      </header>

      <form onSubmit={finish} className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Nghe hội thoại</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <audio controls preload="none" src={scenario.audioUrl} onError={() => setAudioError(true)} aria-label="Hội thoại tiếng Anh" className="w-full" />
            {audioError && <p role="status">Âm thanh chưa tải được. Bạn có thể đọc lời thoại bên dưới.</p>}
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer font-medium">Xem lời thoại</summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                {scenario.dialogue.map((line, index) => (
                  <div key={index} className="contents">
                    <dt className="text-sm text-muted-foreground">{line.speaker}</dt>
                    <dd lang="en">{line.text}</dd>
                  </div>
                ))}
              </dl>
            </details>

            {scenario.questions.map((item, index) => (
              <fieldset key={item.question} className="space-y-2" disabled={complete.isPending || complete.isSuccess}>
                <legend className="mb-2 font-semibold">{item.question}</legend>
                {item.options.map((option, optionIndex) => (
                  <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-checked:border-primary has-checked:bg-accent">
                    <input
                      type="radio"
                      name={`question-${index}`}
                      value={optionIndex}
                      required
                      checked={answers[index] === optionIndex}
                      onChange={() => setAnswers((previous) => ({ ...previous, [index]: optionIndex }))}
                      className="accent-primary"
                    />
                    {option}
                  </label>
                ))}
                {complete.data && (
                  <p role="status" className="rounded-lg bg-muted p-3 text-sm">
                    {complete.data.results[index].isCorrect ? 'Chính xác.' : `Đáp án đúng là “${item.options[complete.data.results[index].correctAnswer]}”.`}{' '}
                    {complete.data.results[index].explanation}
                  </p>
                )}
              </fieldset>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Đến lượt bạn trả lời</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label htmlFor="practice-response" className="block">{scenario.response.prompt}</label>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-primary">Gợi ý tiếng Việt</summary>
              <p className="mt-2">{scenario.response.hint}</p>
            </details>
            <textarea
              id="practice-response"
              rows={2}
              lang="en"
              maxLength={500}
              value={answerText}
              onChange={(event) => { setAnswerText(event.target.value); setShowModel(false); }}
              disabled={complete.isPending || complete.isSuccess}
              className="w-full rounded-lg border border-border bg-background p-3 text-base focus-visible:outline-2 focus-visible:outline-primary"
            />
            {showModel ? (
              <div className="space-y-1 rounded-lg bg-muted p-3 text-sm" role="status">
                <p>Một cách trả lời</p>
                <p lang="en" className="font-semibold">{scenario.response.example}</p>
                <p>Đọc câu bạn vừa viết thành tiếng rồi đối chiếu với câu mẫu.</p>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={!/\p{L}/u.test(answerText)} onClick={() => setShowModel(true)}>
                Đối chiếu với câu mẫu
              </Button>
            )}
          </CardContent>
        </Card>

        {!complete.isSuccess && (
          <div className="space-y-2">
            {complete.isError && <p role="alert">Chưa lưu được bài. Câu trả lời vẫn ở đây để bạn gửi lại.</p>}
            <Button type="submit" disabled={!allSelected || !showModel || complete.isPending}>
              {complete.isPending ? 'Đang lưu…' : complete.isError ? 'Gửi lại kết quả' : 'Hoàn thành bài'}
            </Button>
          </div>
        )}
      </form>

      {complete.data && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" /> Đã lưu kết quả
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p role="status">Hiểu hội thoại · {complete.data.score}/{complete.data.total} câu đúng</p>
            <div className="rounded-lg bg-muted p-3">
              <p lang="en" className="font-semibold">{scenario.phrase.text}</p>
              <p className="text-sm">{scenario.phrase.meaning}</p>
            </div>
            {savePhrase.isError && <p role="alert">Chưa lưu được mẫu câu. Bạn có thể thử lại.</p>}
            {savePhrase.data ? (
              <Link href={`/flashcards/${savePhrase.data.deckId}/study`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Đã lưu · Mở bộ thẻ ôn tập
              </Link>
            ) : (
              <Button type="button" variant="outline" disabled={savePhrase.isPending} onClick={() => savePhrase.mutate()}>
                <Brain className="h-4 w-4" aria-hidden="true" />
                {savePhrase.isPending ? 'Đang lưu câu…' : 'Ôn câu này'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
