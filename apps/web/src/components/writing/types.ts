export interface WritingError {
  original: string;
  correction: string;
  explanation: string;
  type: string;
}

export interface WritingResult {
  id: string;
  overallScore: number;
  feedback: string;
  errors: WritingError[];
  suggestions: string[];
  rewrittenText: string | null;
  scores: {
    grammar?: number;
    vocabulary?: number;
    coherence?: number;
    taskAchievement?: number;
  };
  language: string;
  targetLevel: string;
  createdAt: string;
  userText: string;
}

export interface HistoryItem {
  id: string;
  userText: string;
  language: string;
  createdAt: string;
  overallScore: number;
  errorCount: number;
  feedback: string;
  rewrittenText: string | null;
  suggestions: string[];
  errors: WritingError[];
  scores: {
    grammar?: number;
    vocabulary?: number;
    coherence?: number;
    taskAchievement?: number;
  };
}

export interface ErrorPattern {
  category: string;
  pattern_name: string;
  frequency: number;
  description: string;
  examples: string[];
}

export interface ErrorExercise {
  type: string;
  target_pattern: string;
  instruction: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export interface ErrorAnalysis {
  analyzedSubmissions: number;
  totalErrors: number;
  level: string;
  summary: string;
  patterns: ErrorPattern[];
  exercises: ErrorExercise[];
  priority_focus: string;
}
