// ── Enums (aligned with Prisma schema) ────────────────
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  MODERATOR = 'MODERATOR',
}

export enum AuthProvider {
  LOCAL = 'LOCAL',
  GOOGLE = 'GOOGLE',
  GITHUB = 'GITHUB',
}

export enum DeleteStatus {
  ACTIVE = 'ACTIVE',
  DELETE_REQUESTED = 'DELETE_REQUESTED',
  GRACE_PERIOD = 'GRACE_PERIOD',
  PERMANENTLY_DELETED = 'PERMANENTLY_DELETED',
}

export enum LanguageLevel {
  A1 = 'A1',
  A2 = 'A2',
  B1 = 'B1',
  B2 = 'B2',
  C1 = 'C1',
  C2 = 'C2',
}

export enum ReviewQuality {
  AGAIN = 'AGAIN',
  HARD = 'HARD',
  GOOD = 'GOOD',
  EASY = 'EASY',
}

export enum QuestionType {
  MCQ = 'MCQ',
  TRUE_FALSE = 'TRUE_FALSE',
  FILL_BLANK = 'FILL_BLANK',
}

export enum NotificationType {
  SYSTEM = 'SYSTEM',
  LEARNING_REMINDER = 'LEARNING_REMINDER',
  ACHIEVEMENT = 'ACHIEVEMENT',
  STREAK = 'STREAK',
}

// ── API Types ──────────────────────────────────────────
export interface IApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: string;
  path: string;
}

export interface IPaginatedResponse<T> extends IApiResponse<T[]> {
  pagination: {
    page: number;
    size: number;
    total: number;
    totalPages: number;
  };
}

// ── User Types ─────────────────────────────────────────
export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  role: UserRole;
  emailVerified: boolean;
  preferredLanguage?: string;
  targetLanguage?: string;
  streakCount: number;
  totalXp: number;
  dailyGoal?: number;
  createdAt: string;
}

// ── Auth Types ─────────────────────────────────────────
export interface ILoginRequest {
  email: string;
  password: string;
  deviceId?: string;
  deviceName?: string;
}

export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}

export interface IAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: IUser;
  mfaRequired?: boolean;
  mfaToken?: string;
}

// ── Flashcard Types ────────────────────────────────────
export interface IDeck {
  id: string;
  name: string;
  description?: string;
  language: string;
  level: LanguageLevel;
  cardCount: number;
  userId: string;
  createdAt: string;
}

export interface ICard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  example?: string;
  audioUrl?: string;
  imageUrl?: string;
  tags?: string[];
}

export interface IUserCardProgress {
  id: string;
  cardId: string;
  userId: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  dueDate: string;
  lastReviewDate?: string;
  quality: ReviewQuality;
}

export interface IReviewSession {
  id: string;
  deckId: string;
  userId: string;
  cardsReviewed: number;
  correctCount: number;
  startTime: string;
  endTime?: string;
}

// ── Quiz Types ─────────────────────────────────────────
export interface IQuiz {
  id: string;
  title: string;
  description?: string;
  language: string;
  level: LanguageLevel;
  questions: IQuizQuestion[];
  timeLimit?: number;
}

export interface IQuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

// ── AI Types ───────────────────────────────────────────
export interface IWritingAssessment {
  overallScore: number;
  grammarScore: number;
  vocabularyScore: number;
  coherenceScore: number;
  feedback: string;
  errors: IWritingError[];
}

export interface IWritingError {
  type: string;
  original: string;
  correction: string;
  explanation: string;
}

export interface IReadingPassage {
  title: string;
  content: string;
  level: LanguageLevel;
  language: string;
  questions: IReadingQuestion[];
}

export interface IReadingQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface IGrammarExplanation {
  title: string;
  explanation: string;
  examples: string[];
  practiceExercises: IPracticeExercise[];
}

export interface IPracticeExercise {
  question: string;
  answer: string;
}

export interface IChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}
