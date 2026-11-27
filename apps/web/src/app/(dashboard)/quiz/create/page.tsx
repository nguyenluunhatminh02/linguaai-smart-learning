'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useLearningLanguageStore } from '@/stores/learning-language-store';

interface QuestionForm {
  question: string;
  options: string[];
  correctAnswer: number;
}

export default function CreateQuizPage() {
  const router = useRouter();
  const language = useLearningLanguageStore((state) => state.language);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuestionForm[]>([
    { question: '', options: ['', '', '', ''], correctAnswer: 0 },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const addQuestion = () => {
    setQuestions([...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0 }]);
  };

  const removeQuestion = (index: number) => {
    if (questions.length <= 1) return;
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: 'question' | 'correctAnswer', value: string | number) => {
    const updated = [...questions];
    if (field === 'question') {
      updated[index] = { ...updated[index], question: value as string };
    } else if (field === 'correctAnswer') {
      updated[index] = { ...updated[index], correctAnswer: value as number };
    }
    setQuestions(updated);
  };

  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    const updated = [...questions];
    updated[qIndex].options[oIndex] = value;
    setQuestions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const prepared = questions.map((q) => {
      const selected = q.options[q.correctAnswer]?.trim() ?? '';
      const options = q.options.map((option) => option.trim()).filter(Boolean);
      return { questionText: q.question.trim(), questionType: 'mcq', options, correctAnswer: selected };
    });
    if (!title.trim() || prepared.some((q) => !q.questionText || q.options.length < 2 || !q.options.includes(q.correctAnswer))) {
      setError('Kiểm tra lại: mỗi câu cần ít nhất hai đáp án và một đáp án đúng đã chọn.');
      return;
    }
    setCreating(true);
    try {
      await apiClient.post('/quiz', { title: title.trim(), description, language, questions: prepared });
      router.push('/quiz');
    } catch {
      setError('Chưa tạo được quiz. Hãy thử lại.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/quiz">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Create Quiz</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Quiz Info */}
        <Card>
          <CardContent className="space-y-4 px-6 py-6">
            <Input label="Quiz Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </CardContent>
        </Card>

        {/* Questions */}
        {questions.map((q, qi) => (
          <Card key={qi} className="animate-fade-in">
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Badge>{qi + 1}</Badge>
                  Question
                </div>
                {questions.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => removeQuestion(qi)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-6 pb-6">
              <Input
                label="Question"
                value={q.question}
                onChange={(e) => updateQuestion(qi, 'question', e.target.value)}
                required
              />
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground">Options (select the correct answer)</p>
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-3">
                    <button
                      type="button"
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                        q.correctAnswer === oi
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-muted-foreground/20 hover:border-primary/50'
                      }`}
                      onClick={() => updateQuestion(qi, 'correctAnswer', oi)}
                    >
                      {String.fromCharCode(65 + oi)}
                    </button>
                    <Input
                      className="flex-1"
                      placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                      value={opt}
                      onChange={(e) => updateOption(qi, oi, e.target.value)}
                      required
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" className="rounded-xl" onClick={addQuestion}>
            <Plus className="mr-2 h-4 w-4" /> Add Question
          </Button>
          <Button type="submit" variant="gradient" disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
              </>
            ) : (
              'Create Quiz'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
