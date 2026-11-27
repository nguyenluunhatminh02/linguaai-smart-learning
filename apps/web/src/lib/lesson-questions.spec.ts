import { describe, expect, it } from 'vitest';
import { normalizeLessonQuestions } from './lesson-questions';

describe('normalizeLessonQuestions', () => {
  const options = ['6:00', '7:00', '7:30', '8:00'];

  it('accepts a numeric zero-based index', () => {
    const { questions, invalidQuestionCount } = normalizeLessonQuestions([
      { question: 'What time?', options, correctAnswer: 1 },
    ]);
    expect(questions[0].correctAnswer).toBe(1);
    expect(invalidQuestionCount).toBe(0);
  });

  it('accepts a text answer such as 7:00 instead of treating index 0 as correct', () => {
    const { questions } = normalizeLessonQuestions([
      { question: 'What time?', options, correctAnswer: '7:00' },
    ]);
    expect(questions[0].correctAnswer).toBe(1);
  });

  it('accepts letter answers', () => {
    const { questions } = normalizeLessonQuestions([
      { question: 'Letter', options, correct: 'B.' },
    ]);
    expect(questions[0].correctAnswer).toBe(1);
  });

  it('accepts boolean answers', () => {
    const { questions } = normalizeLessonQuestions([
      { question: 'Boolean', options: ['True', 'False'], correctAnswer: 'False' },
    ]);
    expect(questions[0].options).toEqual(['True', 'False']);
    expect(questions[0].correctAnswer).toBe(1);
  });

  it('skips invalid answers instead of defaulting to the first option', () => {
    const { questions, invalidQuestionCount } = normalizeLessonQuestions([
      { question: 'Bad index', options, correctAnswer: 9 },
      { question: 'Duplicated text', options: ['A', 'A'], correctAnswer: 'A' },
    ]);
    expect(questions).toHaveLength(0);
    expect(invalidQuestionCount).toBe(2);
  });
});
