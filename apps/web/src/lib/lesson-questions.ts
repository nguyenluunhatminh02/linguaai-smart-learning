export interface LessonQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

function questionAnswer(options: string[], answer: unknown): number {
  if (typeof answer === 'number') return Number.isInteger(answer) ? answer : -1;
  if (typeof answer === 'boolean') answer = String(answer);
  if (typeof answer !== 'string') return -1;

  const normalized = answer.trim().toLowerCase();
  if (!normalized) return -1;
  const matches = options.map((option, index) => option.trim().toLowerCase() === normalized ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length > 1) return -1;
  if (matches.length === 1) return matches[0];
  const letter = normalized.match(/^([a-z])(?:[.)]?\s*)?$/)?.[1];
  return letter ? letter.charCodeAt(0) - 97 : -1;
}

export function normalizeLessonQuestions(value: unknown) {
  if (!Array.isArray(value)) return { questions: [], invalidQuestionCount: value == null ? 0 : 1 };

  const questions: LessonQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.question !== 'string' || !item.question.trim()) continue;
    const answer = item.correctAnswer ?? item.correct_answer ?? item.correctIndex ?? item.correct_index ?? item.correct ?? item.answer;
    if (item.options != null && !Array.isArray(item.options)) continue;
    const options = item.options?.length > 0 ? item.options
      : typeof answer === 'boolean' || (typeof answer === 'string' && /^(true|false)$/i.test(answer.trim()))
        ? ['True', 'False']
        : [];
    if (options.length < 2 || options.some((option: unknown) => typeof option !== 'string' || !option.trim())) continue;

    const correctAnswer = questionAnswer(options, answer);
    if (correctAnswer < 0 || correctAnswer >= options.length) continue;
    questions.push({
      question: item.question,
      options,
      correctAnswer,
      explanation: typeof item.explanation === 'string' ? item.explanation : '',
    });
  }
  return { questions, invalidQuestionCount: value.length - questions.length };
}
