export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
export const AI_SERVICE_URL = process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8000';

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  LANGUAGE: 'linguaai-locale',
  LEARNING_LANGUAGE: 'linguaai-learning-lang',
} as const;

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  DASHBOARD: '/dashboard',
  FLASHCARDS: '/flashcards',
  QUIZ: '/quiz',
  READING: '/reading',
  WRITING: '/writing',
  GRAMMAR: '/grammar',
  CHAT: '/chat',
  PROFILE: '/profile',
  ADMIN: '/admin',
  CMS: '/cms',
} as const;
