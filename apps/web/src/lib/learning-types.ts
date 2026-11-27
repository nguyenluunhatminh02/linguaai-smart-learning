export interface CommunicationScenarioSummary {
  slug: string;
  level: 'A1' | 'A2';
  title: string;
  objective: string;
  estimatedMinutes: number;
}

export interface CommunicationScenario extends CommunicationScenarioSummary {
  audioUrl: string;
  dialogue: { speaker: string; text: string }[];
  questions: { question: string; options: string[] }[];
  response: { prompt: string; hint: string; example: string };
  phrase: { text: string; meaning: string; context: string };
}

export interface LearningCompletion {
  activityType: 'scenario' | 'reading' | 'listening';
  activityId: string;
}

export interface ScenarioResults {
  results: { correctAnswer: number; explanation: string; isCorrect: boolean }[];
  score: number;
  total: number;
}
