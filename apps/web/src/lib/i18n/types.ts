export type Locale = "en" | "vi" | "zh" | "ja" | "ko";

export interface Translations {
  // Common
  common: {
    appName: string;
    loading: string;
    loadingDesc: string;
    poweredBy: string;
    poweredByDesc: string;
    save: string;
    cancel: string;
    create: string;
    delete: string;
    edit: string;
    search: string;
    submit: string;
    back: string;
    next: string;
    previous: string;
    noResults: string;
    admin: string;
    adminPanel: string;
    insufficientTokens: string;
    outOfTokens: string;
    skipToContent: string;
  };

  // Notifications
  notifications: {
    title: string;
    newSuffix: string;
    readAll: string;
    noNotifications: string;
    markAsRead: string;
  };

  // Navigation
  nav: {
    dashboard: string;
    flashcards: string;
    writing: string;
    reading: string;
    grammar: string;
    aiTutor: string;
    quiz: string;
    profile: string;
    vocabulary: string;
    speedReview: string;
    listening: string;
    difficultWords: string;
    leaderboard: string;
    goals: string;
    pricing: string;
    translation: string;
    chineseLearning: string;
    japaneseLearning: string;
    zhHub: string;
    zhVocabulary: string;
    zhGrammar: string;
    zhTranslation: string;
    zhReading: string;
    jaHub: string;
    jaVocabulary: string;
    jaGrammar: string;
    jaTranslation: string;
    jaReading: string;
    cms: string;
    speaking: string;
    language: string;
    tools: string;
    coreStudy: string;
    skillsPractice: string;
    toolsReference: string;
    account: string;
  };

  // Auth
  auth: {
    signIn: string;
    signUp: string;
    signOut: string;
    email: string;
    password: string;
    passwordHint: string;
    displayName: string;
    welcomeBack: string;
    signInDesc: string;
    signingIn: string;
    createAccount: string;
    createAccountDesc: string;
    creatingAccount: string;
    noAccount: string;
    hasAccount: string;
    createOne: string;
    signInLink: string;
    loginFailed: string;
    registerFailed: string;
    heroTitle: string;
    heroDesc: string;
    featureSRS: string;
    featureAI: string;
    featureLocal: string;
    studentInfo: string;
  };

  // Landing page
  landing: {
    badge: string;
    heroTitle1: string;
    heroTitle2: string;
    heroTitle3: string;
    heroDesc: string;
    startFree: string;
    haveAccount: string;
    statModules: string;
    statLanguages: string;
    statAI: string;
    statPrivacy: string;
    featuresTitle: string;
    featuresDesc: string;
    featureFlashcards: string;
    featureFlashcardsDesc: string;
    featureWriting: string;
    featureWritingDesc: string;
    featureAITutor: string;
    featureAITutorDesc: string;
    featureReading: string;
    featureReadingDesc: string;
    featureGrammar: string;
    featureGrammarDesc: string;
    featureQuiz: string;
    featureQuizDesc: string;
    ctaTitle: string;
    ctaDesc: string;
    ctaButton: string;
    footerLocal: string;
    footerStudent: string;
  };

  // Dashboard
  dashboard: {
    welcomeBack: string;
    allCaughtUp: string;
    hasDueCards: string;
    explore: string;
    dayStreak: string;
    totalXP: string;
    cardsDue: string;
    mastered: string;
    quickActions: string;
    reviewFlashcards: string;
    reviewFlashcardsDesc: string;
    writingPractice: string;
    writingPracticeDesc: string;
    aiTutorChat: string;
    aiTutorChatDesc: string;
    takeQuiz: string;
    takeQuizDesc: string;
    studyProgress: string;
    cardsMastered: string;
    totalDecks: string;
    totalReviews: string;
    todaysGoals: string;
    reviewDueCards: string;
    allDone: string;
    keepStreak: string;
    startStreak: string;
    learningPath: string;
    learningPathAi: string;
    learningPathEmpty: string;
    learningPathGenerating: string;
    cardsRemaining: string;
    dayStreakFire: string;
    learningTree: string;
    learningTreeDesc: string;
    weeklyActivity: string;
    noActivityThisWeek: string;
    learnerDefault: string;
  };

  // Flashcards
  flashcards: {
    title: string;
    desc: string;
    newDeck: string;
    deckName: string;
    deckNamePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    createDeck: string;
    noDecks: string;
    noDecksDesc: string;
    createFirst: string;
    cards: string;
    study: string;
    addCards: string;
    tabDecks: string;
    tabMemoryHealth: string;
    publicBadge: string;
    memoryLoading: string;
    memoryCardsTracked: string;
    memoryAvgRetention: string;
    memoryAtRisk: string;
    memoryEmptyState: string;
    memoryViewDecks: string;
    deckFallback: string;
    memoryAtRiskBadge: string;
    memoryRetentionBadge: string;
    memoryWeakestCards: string;
    memoryRetentionLabel: string;
    memoryStabilityReps: string;
    memoryStudyNow: string;
    memoryCouldNotLoad: string;
    memoryRetry: string;
  };

  // Writing
  writing: {
    title: string;
    desc: string;
    yourWriting: string;
    placeholder: string;
    getFeedback: string;
    characters: string;
    writeAndGet: string;
    writeAndGetDesc: string;
    analyzing: string;
    overallScore: string;
    grammarScore: string;
    vocabScore: string;
    coherenceScore: string;
    feedback: string;
    corrections: string;
    suggestions: string;
    tabWrite: string;
    tabHistory: string;
    rewrittenText: string;
    copyText: string;
    copied: string;
    historyEmpty: string;
    historyEmptyDesc: string;
    errorsFound: string;
    viewDetail: string;
    hideDetail: string;
    loadMore: string;
    tabErrors: string;
    errorsAnalyze: string;
    errorsAnalyzing: string;
    errorsAnalysis: string;
    errorsNoData: string;
    errorsStartAnalysis: string;
    errorsStart: string;
    taskAchievement: string;
  };

  // Reading
  reading: {
    title: string;
    desc: string;
    topicPlaceholder: string;
    generate: string;
    generating: string;
    savedPassages: string;
    refresh: string;
    noSavedPassages: string;
    backToList: string;
    analyzeText: string;
    analyzingText: string;
    nlpTitle: string;
    nlpDesc: string;
  };

  // Grammar
  grammar: {
    title: string;
    desc: string;
    topicPlaceholder: string;
    explain: string;
    explaining: string;
  };

  // Chat
  chat: {
    title: string;
    newChat: string;
    online: string;
    aiTutorName: string;
    aiTutorDesc: string;
    suggestion1: string;
    suggestion2: string;
    suggestion3: string;
    placeholder: string;
    sending: string;
  };

  // Quiz
  quiz: {
    title: string;
    desc: string;
    createQuiz: string;
    noQuizzes: string;
    noQuizzesDesc: string;
    createFirst: string;
    questions: string;
    startQuiz: string;
  };

  // Profile
  profile: {
    title: string;
    dayStreak: string;
    totalXP: string;
    joined: string;
    editProfile: string;
    email: string;
    displayName: string;
    nativeLanguage: string;
    targetLanguage: string;
    saveChanges: string;
    selectLanguage: string;
  };

  // Languages (for selectors)
  languages: {
    english: string;
    vietnamese: string;
    japanese: string;
    korean: string;
    chinese: string;
    french: string;
    spanish: string;
  };

  // Language selector
  langSwitcher: {
    label: string;
  };

  // Pricing
  pricing: {
    title: string;
    subtitle: string;
    monthly: string;
    yearly: string;
    yearlyDiscount: string;
    free: string;
    freePrice: string;
    freeDesc: string;
    pro: string;
    proPrice: string;
    proDesc: string;
    premium: string;
    premiumPrice: string;
    premiumDesc: string;
    currentPlan: string;
    upgrade: string;
    popular: string;
    features: {
      freeFeatures: string[];
      proFeatures: string[];
      premiumFeatures: string[];
    };
    faq: string;
    faqItems: { q: string; a: string }[];
    guarantee: string;
  };

  // Vocabulary Tracker
  vocabulary: {
    title: string;
    desc: string;
    knownWords: string;
    learningWords: string;
    newWords: string;
    totalWords: string;
    addWord: string;
    wordPlaceholder: string;
    meaningPlaceholder: string;
    examplePlaceholder: string;
    markKnown: string;
    markLearning: string;
    status: string;
    new: string;
    learning: string;
    known: string;
    noWords: string;
    noWordsDesc: string;
    search: string;
    filter: string;
    all: string;
  };

  // Speed Review
  speedReview: {
    title: string;
    desc: string;
    start: string;
    correct: string;
    incorrect: string;
    timeLeft: string;
    score: string;
    streak: string;
    bestStreak: string;
    roundComplete: string;
    accuracy: string;
    wordsReviewed: string;
    playAgain: string;
    noCards: string;
    noCardsDesc: string;
  };

  // Listening
  listening: {
    title: string;
    desc: string;
    play: string;
    pause: string;
    replay: string;
    speed: string;
    transcriptToggle: string;
    checkAnswer: string;
    generating: string;
    topicPlaceholder: string;
    generate: string;
    dictation: string;
    dictationDesc: string;
    comprehension: string;
    comprehensionDesc: string;
    typePlaceholder: string;
  };

  // Difficult Words
  difficultWords: {
    title: string;
    desc: string;
    noWords: string;
    noWordsDesc: string;
    practiceAll: string;
    remove: string;
    attempts: string;
    lastAttempt: string;
    accuracy: string;
  };

  // Leaderboard
  leaderboard: {
    title: string;
    desc: string;
    rank: string;
    user: string;
    xp: string;
    wordsLearned: string;
    streak: string;
    thisWeek: string;
    thisMonth: string;
    allTime: string;
    you: string;
    topLearners: string;
  };

  // Goals
  goals: {
    title: string;
    desc: string;
    dailyGoal: string;
    weeklyGoal: string;
    setGoal: string;
    minutesPerDay: string;
    wordsPerDay: string;
    reviewsPerDay: string;
    progress: string;
    completed: string;
    goalReached: string;
    keepGoing: string;
  };

  speaking: {
    title: string;
    desc: string;
    selectLevel: string;
    selectCategory: string;
    generating: string;
    start: string;
    record: string;
    stop: string;
    newTopic: string;
    yourSpeech: string;
    analyzing: string;
    pronunciation: string;
    fluency: string;
    grammarLabel: string;
    vocabularyLabel: string;
    tryAgain: string;
    changeSettings: string;
    browserWarning: string;
    browserWarningDesc: string;
  };

  translationPage: {
    desc: string;
    sentencesSuffix: string;
    back: string;
    allLevels: string;
    allCategories: string;
    categories: {
      daily: string;
      travel: string;
      work: string;
      social: string;
      opinion: string;
      academic: string;
    };
    aiGenerate: string;
    aiTitle: string;
    aiTopicPlaceholder: string;
    aiGenerating: string;
    aiCreate: string;
    aiCancel: string;
    noLessons: string;
    promptDirection: string;
    sourceLabel: string;
    yourTranslation: string;
    inputPlaceholder: string;
    check: string;
    next: string;
    seeResult: string;
    correctTitle: string;
    incorrectTitle: string;
    sampleAnswer: string;
    altAnswers: string;
    youWrote: string;
    answer: string;
    restart: string;
    pickAnother: string;
    summaryCorrect: string;
    summaryPerfect: string;
    summaryGood: string;
    summaryKeepPracticing: string;
    detailResults: string;
  };

  tokens: {
    title: string;
    subtitle: string;
    currentBalance: string;
    freePerDay: string;
    packagesTab: string;
    costsTab: string;
    starter: string;
    basic: string;
    plus: string;
    pro: string;
    tokensSuffix: string;
    buy: string;
    bonus: string;
    popular: string;
    bestValue: string;
    processing: string;
    buyNow: string;
    moneyBack: string;
    costsTitle: string;
    usesLeft: string;
    chatRuns: string;
    writingRuns: string;
    faqTitle: string;
    featureLabels: {
      ai_chat: string;
      writing_feedback: string;
      reading_generate: string;
      grammar_explain: string;
      listening_generate: string;
      quiz_generate: string;
      translation_ai: string;
      speaking_feedback: string;
      learning_path: string;
      cards_generate: string;
    };
    faq: { q: string; a: string }[];
    purchaseSuccess: string;
  };

  dashboardCheckin: {
    title: string;
    streakDays: string;
    tokensReward: string;
    checkin: string;
    day: string;
  };

  // Admin CMS
  admin: {
    // Page titles
    createLesson: string;
    editLesson: string;
    fillInfo: string;
    // Header buttons
    draft: string;
    published: string;
    saving: string;
    saveLesson: string;
    // Basic info card
    basicInfo: string;
    lessonType: string;
    language: string;
    level: string;
    category: string;
    categoryPlaceholder: string;
    titleOriginal: string;
    titleVietnamese: string;
    slugUrl: string;
    source: string;
    description: string;
    descriptionPlaceholder: string;
    // Lesson type options
    typeGrammar: string;
    typeTranslation: string;
    typeReading: string;
    typeVocabulary: string;
    typeListening: string;
    // Language options
    langEnglish: string;
    langChinese: string;
    langJapanese: string;
    // Content card
    lessonContent: string;
    // Right panel
    thumbnail: string;
    lessonImages: string;
    settings: string;
    sortOrder: string;
    sortOrderHint: string;
    // Vocabulary
    vocabulary: string;
    addVocab: string;
    word: string;
    definition: string;
    definitionVi: string;
    // Questions
    comprehensionQuestions: string;
    listeningQuestions: string;
    addQuestion: string;
    questionN: string;
    questionPlaceholder: string;
    answerN: string;
    answerExplanation: string;
    answerExplanationPlaceholder: string;
    // Listening
    audioFile: string;
    duration: string;
    transcript: string;
    transcriptPlaceholder: string;
    aiGenerate: string;
    aiGenerating: string;
    aiGenerateSuccess: string;
    // Admin panel page
    adminSystem: string;
    adminSystemDesc: string;
    overview: string;
    manageUsers: string;
    manageLessons: string;
    backToMain: string;
    platformStats: string;
    totalDecks: string;
    totalFlashcards: string;
    totalReviews: string;
    totalContent: string;
    lessonsByType: string;
    totalLessonsSuffix: string;
    quickActions: string;
    createNewLessonDesc: string;
    manageLessonsDesc: string;
    manageUsersDesc: string;
    lessonsList: string;
    lessonsListDesc: string;
    searchLessons: string;
    searchLessonsPlaceholder: string;
    filterByType: string;
    allTypes: string;
    filterByLang: string;
    allLanguages: string;
    noLessonsYet: string;
    noLessonsYetDesc: string;
    createFirstLesson: string;
    totalLessonsTitle: string;
    publishedTitle: string;
    draftTitle: string;
    colLesson: string;
    colType: string;
    colLanguage: string;
    colLevel: string;
    colSource: string;
    colStatus: string;
    colActions: string;
    editLessonTooltip: string;
    deleteLessonTooltip: string;
    deleteConfirm: string;
    paginationInfo: string;
    usersCount: string;
    searchUsersPlaceholder: string;
    noUsersFound: string;
    noUsersYet: string;
    colUser: string;
    colRole: string;
    colTokens: string;
    colXp: string;
    colJoined: string;
    colTime: string;
    colFeature: string;
    colAmount: string;
    colBalanceAfter: string;
    grantTokensTooltip: string;
    txHistoryTooltip: string;
    deleteUserTooltip: string;
    deleteUserConfirm: string;
    grantTokensModalTitle: string;
    grantTokensModalDesc: string;
    tokenAmountLabel: string;
    tokenAmountPlaceholder: string;
    submitting: string;
    grantTokensSubmit: string;
    txHistoryModalTitle: string;
    exportCsv: string;
    close: string;
    txHistoryModalDesc: string;
    noTxYet: string;
    txTypePurchase: string;
    txTypeBonus: string;
    txTypeDailyTopup: string;
    txTypeAdminGrant: string;
    txTypeAdminDeduct: string;
    txTypeConsumption: string;
    formula: string;
    explanation: string;
    explanationPlaceholder: string;
    examples: string;
    exampleOriginalPlaceholder: string;
    exampleViPlaceholder: string;
    exercises: string;
    tips: string;
    tipPlaceholder: string;
    commonMistakes: string;
    mistakeWrongPlaceholder: string;
    mistakeRightPlaceholder: string;
    mistakeNotePlaceholder: string;
    translationSentences: string;
    hintPlaceholder: string;
    readingContentPlaceholder: string;
    wordsCountSuffix: string;
    pronunciation: string;
    posNoun: string;
    posVerb: string;
    posAdjective: string;
    posAdverb: string;
    posPhrase: string;
    posParticle: string;
    themeColor: string;
    aiGenerationError: string;
    addBtnLabel: string;
    toastLessonNotFound: string;
    uploadFailed: string;
    uploading: string;
    selectAudioFile: string;
    audioUrlPlaceholder: string;
    selectImage: string;
    orDragDrop: string;
    imageFormatLimit: string;
    addImage: string;
  };
}

export const localeNames: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
};

// Use Unicode escapes for flag emoji to avoid editor/encoding corruption.
// Each flag is two regional-indicator code points (U+1F1E6..U+1F1FF).
export const localeFlags: Record<Locale, string> = {
  en: "\u{1F1FA}\u{1F1F8}", // ���
  vi: "\u{1F1FB}\u{1F1F3}", // 🇻🇳
  zh: "\u{1F1E8}\u{1F1F3}", // 🇨🇳
  ja: "\u{1F1EF}\u{1F1F5}", // 🇯🇵
  ko: "\u{1F1F0}\u{1F1F7}", // 🇰🇷
};
