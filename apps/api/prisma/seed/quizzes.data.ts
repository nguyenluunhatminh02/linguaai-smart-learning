// ──────────────────────────────────────────────
// Quizzes Seed Data — LinguaAI
// ──────────────────────────────────────────────

export interface SeedQuizQuestion {
  question_text: string;
  question_type: 'mcq' | 'true_false' | 'fill_blank';
  options?: string[];
  correct_answer: string;
  explanation?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export interface SeedQuiz {
  title: string;
  description: string;
  deckTitle: string;
  time_limit_minutes: number;
  questions: SeedQuizQuestion[];
}

export const QUIZ_CATALOG: SeedQuiz[] = [
  // ════════════════════════════════════════════
  //  ENGLISH QUIZZES
  // ════════════════════════════════════════════

  // 1 ── English — Basic Greetings
  {
    title: 'Greeting Essentials',
    description:
      'Test your knowledge of common English greetings and introductions used in everyday life.',
    deckTitle: 'English — Basic Greetings',
    time_limit_minutes: 5,
    questions: [
      {
        question_text: 'What is the most common informal greeting in English?',
        question_type: 'mcq',
        options: ['Good evening', 'Hello', 'Farewell', 'Pardon me'],
        correct_answer: 'Hello',
        explanation:
          '"Hello" is the most universally recognised informal greeting in English, suitable for almost any casual situation.',
        difficulty: 1,
      },
      {
        question_text:
          '"How do you do?" is typically used as a casual greeting among friends.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"How do you do?" is a formal greeting used when meeting someone for the first time, not among close friends.',
        difficulty: 2,
      },
      {
        question_text:
          'Complete the greeting: "Nice to _____ you." (when meeting someone for the first time)',
        question_type: 'fill_blank',
        correct_answer: 'meet',
        explanation:
          '"Nice to meet you" is the standard phrase for first introductions.',
        difficulty: 1,
      },
      {
        question_text:
          'Which response is appropriate when someone says "How are you?"',
        question_type: 'mcq',
        options: [
          'I am 25 years old.',
          'I am fine, thank you.',
          'My name is John.',
          'See you later.',
        ],
        correct_answer: 'I am fine, thank you.',
        difficulty: 1,
      },
      {
        question_text: 'What does "Good evening" signify?',
        question_type: 'mcq',
        options: [
          'A greeting used in the morning',
          'A farewell phrase',
          'A greeting used after about 6 PM',
          'A greeting used only at midnight',
        ],
        correct_answer: 'A greeting used after about 6 PM',
        explanation:
          '"Good evening" is a formal greeting typically used from around 6 PM onward.',
        difficulty: 2,
      },
      {
        question_text: '"Goodbye" and "See you later" mean exactly the same thing.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"Goodbye" can imply a more permanent farewell, while "See you later" implies you expect to meet again soon.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "Good _____, everyone!" (said when arriving at work in the morning)',
        question_type: 'fill_blank',
        correct_answer: 'morning',
        difficulty: 1,
      },
    ],
  },

  // 2 ── English — Numbers 1 to 20
  {
    title: 'Counting in English',
    description:
      'Practice English numbers from 1 to 20, including spelling and basic arithmetic vocabulary.',
    deckTitle: 'English — Numbers 1 to 20',
    time_limit_minutes: 5,
    questions: [
      {
        question_text: 'How do you spell the number 8 in English?',
        question_type: 'mcq',
        options: ['Eigth', 'Eight', 'Eght', 'Ate'],
        correct_answer: 'Eight',
        explanation: 'The correct spelling is "eight" — a common spelling-bee word.',
        difficulty: 1,
      },
      {
        question_text: 'The number "twelve" comes after "eleven".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Spell the result of 7 + 6: _____',
        question_type: 'fill_blank',
        correct_answer: 'thirteen',
        explanation: '7 + 6 = 13, which is spelled "thirteen".',
        difficulty: 2,
      },
      {
        question_text: 'Which number is spelled "fifteen"?',
        question_type: 'mcq',
        options: ['14', '15', '16', '50'],
        correct_answer: '15',
        difficulty: 1,
      },
      {
        question_text: '"Twenty" is the English word for the number 12.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"Twenty" means 20; the word for 12 is "twelve".',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "There are _____ months in a year." (write the word)',
        question_type: 'fill_blank',
        correct_answer: 'twelve',
        difficulty: 1,
      },
      {
        question_text: 'Which of these is NOT a correct English number word?',
        question_type: 'mcq',
        options: ['Fourteen', 'Sixten', 'Nineteen', 'Seventeen'],
        correct_answer: 'Sixten',
        explanation: 'The correct spelling is "sixteen", not "sixten".',
        difficulty: 2,
      },
    ],
  },

  // 3 ── English — Travel Essentials
  {
    title: 'Travel English Quiz',
    description:
      'Key vocabulary and phrases every traveler needs — airports, hotels, directions, and more.',
    deckTitle: 'English — Travel Essentials',
    time_limit_minutes: 8,
    questions: [
      {
        question_text:
          'What does "boarding pass" refer to?',
        question_type: 'mcq',
        options: [
          'A ticket for a bus',
          'A document allowing you to board an airplane',
          'A hotel reservation confirmation',
          'A passport stamp',
        ],
        correct_answer: 'A document allowing you to board an airplane',
        explanation:
          'A boarding pass is issued at check-in and is required to board a flight.',
        difficulty: 2,
      },
      {
        question_text:
          '"Luggage" and "baggage" can be used interchangeably in travel contexts.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'Both words refer to a traveler\'s suitcases and bags, though "luggage" is more common in British English and "baggage" at airports.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "Excuse me, where is the nearest _____?" (place to exchange money)',
        question_type: 'fill_blank',
        correct_answer: 'currency exchange',
        difficulty: 3,
      },
      {
        question_text:
          'Which phrase would you use to ask for directions?',
        question_type: 'mcq',
        options: [
          'How much is this?',
          'Could you tell me how to get to the station?',
          'I would like to check out.',
          'Do you have a reservation?',
        ],
        correct_answer: 'Could you tell me how to get to the station?',
        difficulty: 2,
      },
      {
        question_text:
          'What does "check-in" mean at a hotel?',
        question_type: 'mcq',
        options: [
          'Leaving the hotel',
          'Registering your arrival',
          'Paying the bill',
          'Ordering room service',
        ],
        correct_answer: 'Registering your arrival',
        explanation:
          '"Check-in" is the process of registering upon arrival at a hotel, as opposed to "check-out" when you leave.',
        difficulty: 1,
      },
      {
        question_text:
          'A "round-trip ticket" means you only travel one way.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          'A round-trip ticket covers travel to a destination AND back. A one-way ticket covers only one direction.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "I\'d like to _____ a room for two nights."',
        question_type: 'fill_blank',
        correct_answer: 'book',
        difficulty: 2,
      },
      {
        question_text:
          'What is the meaning of "itinerary"?',
        question_type: 'mcq',
        options: [
          'A type of luggage',
          'A planned route or schedule of a trip',
          'A travel insurance document',
          'A customs declaration form',
        ],
        correct_answer: 'A planned route or schedule of a trip',
        difficulty: 3,
      },
    ],
  },

  // 4 ── English — Business Essentials
  {
    title: 'Business English Fundamentals',
    description:
      'Essential business vocabulary covering meetings, emails, negotiations, and office communication.',
    deckTitle: 'English — Business Essentials',
    time_limit_minutes: 10,
    questions: [
      {
        question_text: 'What does the abbreviation "ASAP" stand for?',
        question_type: 'mcq',
        options: [
          'As Soon As Possible',
          'Always Send A Paper',
          'After Sales And Purchase',
          'At Start, All Processes',
        ],
        correct_answer: 'As Soon As Possible',
        difficulty: 1,
      },
      {
        question_text:
          'In a business email, "Dear Sir/Madam" is considered an informal greeting.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"Dear Sir/Madam" is a formal salutation typically used when the recipient\'s name is unknown.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "Let\'s schedule a _____ to discuss the quarterly results."',
        question_type: 'fill_blank',
        correct_answer: 'meeting',
        difficulty: 1,
      },
      {
        question_text: 'What is an "agenda" in a business context?',
        question_type: 'mcq',
        options: [
          'A list of topics to discuss at a meeting',
          'A company financial report',
          'A type of business contract',
          'An employee evaluation form',
        ],
        correct_answer: 'A list of topics to discuss at a meeting',
        explanation:
          'An agenda outlines the items or topics to be covered during a meeting.',
        difficulty: 2,
      },
      {
        question_text:
          '"To close a deal" means to fail in a negotiation.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"To close a deal" means to successfully finalize a business agreement or negotiation.',
        difficulty: 2,
      },
      {
        question_text:
          'Which phrase is appropriate for ending a formal business email?',
        question_type: 'mcq',
        options: [
          'See ya!',
          'Kind regards,',
          'Later dude,',
          'XOXO,',
        ],
        correct_answer: 'Kind regards,',
        difficulty: 1,
      },
      {
        question_text:
          'Fill in the blank: "Please find the report _____ to this email."',
        question_type: 'fill_blank',
        correct_answer: 'attached',
        explanation:
          '"Attached" is the standard term for files included with an email.',
        difficulty: 2,
      },
      {
        question_text:
          'What does "deadline" mean?',
        question_type: 'mcq',
        options: [
          'The start date of a project',
          'A line in a budget spreadsheet',
          'The latest date or time by which something must be completed',
          'A type of business agreement',
        ],
        correct_answer:
          'The latest date or time by which something must be completed',
        difficulty: 1,
      },
    ],
  },

  // 5 ── English — Food & Cooking
  {
    title: 'Food & Cooking Vocabulary',
    description:
      'Explore cooking methods, kitchen tools, and food-related vocabulary in English.',
    deckTitle: 'English — Food & Cooking',
    time_limit_minutes: 8,
    questions: [
      {
        question_text:
          'What cooking method involves submerging food completely in hot oil?',
        question_type: 'mcq',
        options: ['Steaming', 'Deep-frying', 'Grilling', 'Poaching'],
        correct_answer: 'Deep-frying',
        explanation:
          'Deep-frying means cooking by fully immersing food in hot oil, as opposed to shallow frying.',
        difficulty: 2,
      },
      {
        question_text: '"To dice" vegetables means to cut them into small cubes.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          '"Dicing" produces small, roughly equal cube-shaped pieces, typically 5-10 mm.',
        difficulty: 1,
      },
      {
        question_text:
          'Fill in the blank: "You need to _____ the onions until they are translucent." (cook gently in a little fat)',
        question_type: 'fill_blank',
        correct_answer: 'sauté',
        difficulty: 3,
      },
      {
        question_text:
          'Which kitchen utensil is used to flip pancakes?',
        question_type: 'mcq',
        options: ['Whisk', 'Spatula', 'Ladle', 'Tongs'],
        correct_answer: 'Spatula',
        difficulty: 1,
      },
      {
        question_text:
          '"Simmering" means cooking at a full, rolling boil.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          'Simmering is cooking just below the boiling point with gentle bubbles; a full rolling boil is more vigorous.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "_____ the garlic and add it to the pan." (cut into very thin pieces)',
        question_type: 'fill_blank',
        correct_answer: 'Mince',
        explanation:
          '"Mince" means to cut into very fine pieces, finer than dicing.',
        difficulty: 2,
      },
      {
        question_text:
          'What does "al dente" mean when cooking pasta?',
        question_type: 'mcq',
        options: [
          'Overcooked and mushy',
          'Firm to the bite',
          'Raw and uncooked',
          'Served cold',
        ],
        correct_answer: 'Firm to the bite',
        explanation:
          '"Al dente" is Italian for "to the tooth", meaning pasta is cooked so it is still slightly firm when bitten.',
        difficulty: 2,
      },
    ],
  },

  // 6 ── English — Body Parts & Health
  {
    title: 'Body & Health Vocabulary',
    description:
      'Learn vocabulary related to the human body, symptoms, and basic health conversations.',
    deckTitle: 'English — Body Parts & Health',
    time_limit_minutes: 7,
    questions: [
      {
        question_text: 'Which body part is responsible for pumping blood?',
        question_type: 'mcq',
        options: ['Lungs', 'Heart', 'Liver', 'Brain'],
        correct_answer: 'Heart',
        difficulty: 1,
      },
      {
        question_text: 'The "elbow" is a joint in the leg.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          'The elbow is a joint in the arm, between the upper arm and forearm. The equivalent joint in the leg is the knee.',
        difficulty: 1,
      },
      {
        question_text:
          'Fill in the blank: "I have a sore _____. It hurts when I swallow." (part of the neck)',
        question_type: 'fill_blank',
        correct_answer: 'throat',
        difficulty: 1,
      },
      {
        question_text:
          'What does "symptom" mean in a medical context?',
        question_type: 'mcq',
        options: [
          'A type of medicine',
          'A physical or mental sign of a disease',
          'A medical instrument',
          'A hospital department',
        ],
        correct_answer: 'A physical or mental sign of a disease',
        explanation:
          'Symptoms are indications that a person is experiencing a particular illness, such as fever, cough, or headache.',
        difficulty: 2,
      },
      {
        question_text:
          '"Prescription" refers to a doctor\'s written instruction for medicine.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "The doctor checked my blood _____." (measurement of force of blood in vessels)',
        question_type: 'fill_blank',
        correct_answer: 'pressure',
        difficulty: 2,
      },
    ],
  },

  // 7 ── English — Weather & Seasons
  {
    title: 'Weather & Seasons Quiz',
    description:
      'Test your understanding of weather phenomena, seasonal vocabulary, and climate expressions.',
    deckTitle: 'English — Weather & Seasons',
    time_limit_minutes: 6,
    questions: [
      {
        question_text:
          'Which word describes a storm with thunder and lightning?',
        question_type: 'mcq',
        options: ['Blizzard', 'Thunderstorm', 'Drought', 'Breeze'],
        correct_answer: 'Thunderstorm',
        difficulty: 1,
      },
      {
        question_text:
          '"Humid" means the air contains a high level of moisture.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'Humidity refers to the amount of water vapor in the air; high humidity makes the air feel damp and heavy.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "In autumn, the leaves change color and _____ from the trees."',
        question_type: 'fill_blank',
        correct_answer: 'fall',
        difficulty: 1,
      },
      {
        question_text: 'What instrument measures temperature?',
        question_type: 'mcq',
        options: ['Barometer', 'Thermometer', 'Anemometer', 'Hygrometer'],
        correct_answer: 'Thermometer',
        explanation:
          'A thermometer measures temperature; a barometer measures atmospheric pressure; an anemometer measures wind speed.',
        difficulty: 2,
      },
      {
        question_text:
          'A "blizzard" is a type of severe snowstorm with strong winds.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "The weather _____ says it will rain tomorrow." (prediction report)',
        question_type: 'fill_blank',
        correct_answer: 'forecast',
        difficulty: 2,
      },
      {
        question_text:
          'Which season comes after winter in the Northern Hemisphere?',
        question_type: 'mcq',
        options: ['Summer', 'Autumn', 'Spring', 'Monsoon'],
        correct_answer: 'Spring',
        difficulty: 1,
      },
    ],
  },

  // 8 ── English — Emotions & Feelings
  {
    title: 'Expressing Emotions',
    description:
      'Identify and describe emotions and feelings using precise English vocabulary.',
    deckTitle: 'English — Emotions & Feelings',
    time_limit_minutes: 7,
    questions: [
      {
        question_text:
          'Which word means a feeling of great happiness?',
        question_type: 'mcq',
        options: ['Anxiety', 'Joy', 'Frustration', 'Boredom'],
        correct_answer: 'Joy',
        difficulty: 1,
      },
      {
        question_text:
          '"Anxious" and "nervous" have very similar meanings.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'Both "anxious" and "nervous" describe a state of worry or unease, though "anxious" can also mean "eager".',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "She was _____ when she heard the sad news." (feeling deep sorrow)',
        question_type: 'fill_blank',
        correct_answer: 'devastated',
        difficulty: 3,
      },
      {
        question_text:
          'What emotion does "furious" describe?',
        question_type: 'mcq',
        options: [
          'Extreme sadness',
          'Extreme anger',
          'Mild surprise',
          'Deep love',
        ],
        correct_answer: 'Extreme anger',
        explanation:
          '"Furious" is a stronger form of "angry", indicating intense rage.',
        difficulty: 2,
      },
      {
        question_text:
          '"Content" means feeling satisfied and at ease.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "He was _____ to hear that he got the promotion." (very happy / excited)',
        question_type: 'fill_blank',
        correct_answer: 'thrilled',
        difficulty: 2,
      },
    ],
  },

  // 9 ── English — Technology & Internet
  {
    title: 'Tech & Internet Vocab',
    description:
      'Modern vocabulary for the digital age — software, hardware, and internet terminology.',
    deckTitle: 'English — Technology & Internet',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "URL" stand for?',
        question_type: 'mcq',
        options: [
          'Universal Resource Locator',
          'Uniform Resource Locator',
          'United Reference Link',
          'Universal Reference Locator',
        ],
        correct_answer: 'Uniform Resource Locator',
        explanation:
          'URL stands for Uniform Resource Locator, the address used to access resources on the internet.',
        difficulty: 2,
      },
      {
        question_text:
          '"Bandwidth" refers to the amount of data that can be transmitted over a network in a given time.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 3,
      },
      {
        question_text:
          'Fill in the blank: "Make sure to _____ your files regularly to avoid data loss." (create a copy for safety)',
        question_type: 'fill_blank',
        correct_answer: 'backup',
        difficulty: 2,
      },
      {
        question_text:
          'What is "phishing" in cybersecurity?',
        question_type: 'mcq',
        options: [
          'A type of firewall',
          'A fraudulent attempt to obtain sensitive information by disguising as a trustworthy entity',
          'A method of encrypting data',
          'A software update process',
        ],
        correct_answer:
          'A fraudulent attempt to obtain sensitive information by disguising as a trustworthy entity',
        difficulty: 3,
      },
      {
        question_text: 'A "browser" is software used to access websites on the internet.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text:
          'Fill in the blank: "The website crashed because the _____ couldn\'t handle the traffic." (computer that hosts websites)',
        question_type: 'fill_blank',
        correct_answer: 'server',
        difficulty: 2,
      },
      {
        question_text:
          'Which of these is a cloud storage service?',
        question_type: 'mcq',
        options: ['Microsoft Word', 'Google Drive', 'Adobe Photoshop', 'Windows Explorer'],
        correct_answer: 'Google Drive',
        difficulty: 1,
      },
    ],
  },

  // 10 ── English — Academic Vocabulary
  {
    title: 'Academic English Challenge',
    description:
      'Advanced vocabulary commonly encountered in academic texts, research papers, and lectures.',
    deckTitle: 'English — Academic Vocabulary',
    time_limit_minutes: 10,
    questions: [
      {
        question_text:
          'What does "hypothesis" mean in a scientific context?',
        question_type: 'mcq',
        options: [
          'A proven scientific law',
          'A proposed explanation that can be tested',
          'The final conclusion of a study',
          'A type of research method',
        ],
        correct_answer: 'A proposed explanation that can be tested',
        explanation:
          'A hypothesis is an educated guess or prediction that forms the basis of scientific experiments.',
        difficulty: 3,
      },
      {
        question_text:
          '"Empirical" data is based on observation or experience rather than theory.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 3,
      },
      {
        question_text:
          'Fill in the blank: "The study provides _____ evidence that supports the theory." (strong / convincing)',
        question_type: 'fill_blank',
        correct_answer: 'compelling',
        difficulty: 4,
      },
      {
        question_text:
          'What does "peer-reviewed" mean?',
        question_type: 'mcq',
        options: [
          'Written by students',
          'Published in a newspaper',
          'Evaluated by experts in the same field before publication',
          'Available for free online',
        ],
        correct_answer: 'Evaluated by experts in the same field before publication',
        difficulty: 3,
      },
      {
        question_text:
          'Fill in the blank: "The researcher conducted a thorough literature _____ before starting the experiment."',
        question_type: 'fill_blank',
        correct_answer: 'review',
        difficulty: 3,
      },
      {
        question_text:
          '"To corroborate" means to contradict or disprove.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"To corroborate" means to confirm or support with additional evidence. The opposite would be "to refute".',
        difficulty: 4,
      },
      {
        question_text:
          'Which word means "a summary of a research paper"?',
        question_type: 'mcq',
        options: ['Bibliography', 'Abstract', 'Appendix', 'Index'],
        correct_answer: 'Abstract',
        explanation:
          'An abstract is a brief summary at the beginning of a research paper outlining the key points.',
        difficulty: 3,
      },
    ],
  },

  // 11 ── English — Idioms & Phrasal Verbs
  {
    title: 'Idioms & Phrasal Verbs',
    description:
      'Master common English idioms and phrasal verbs used in everyday conversation.',
    deckTitle: 'English — Idioms & Phrasal Verbs',
    time_limit_minutes: 10,
    questions: [
      {
        question_text: 'What does "break the ice" mean?',
        question_type: 'mcq',
        options: [
          'To literally crack ice',
          'To initiate conversation in an awkward social situation',
          'To end a friendship',
          'To cool down a drink',
        ],
        correct_answer:
          'To initiate conversation in an awkward social situation',
        explanation:
          '"Break the ice" means to do something to relieve tension or start a conversation in a social setting.',
        difficulty: 2,
      },
      {
        question_text:
          '"To look up" (a word) means to search for information.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          '"Look up" is a phrasal verb meaning to search for information, e.g., in a dictionary or online.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "She decided to _____ up jogging to improve her health." (to start a new activity)',
        question_type: 'fill_blank',
        correct_answer: 'take',
        explanation: '"Take up" means to begin a new hobby or activity.',
        difficulty: 2,
      },
      {
        question_text:
          'What does "once in a blue moon" mean?',
        question_type: 'mcq',
        options: [
          'Every night',
          'Very rarely',
          'During a full moon',
          'Every month',
        ],
        correct_answer: 'Very rarely',
        explanation:
          '"Once in a blue moon" means something happens very infrequently.',
        difficulty: 2,
      },
      {
        question_text:
          '"To put off" something means to do it immediately.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation:
          '"Put off" means to postpone or delay doing something.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "Don\'t give _____ — keep trying!" (to stop trying)',
        question_type: 'fill_blank',
        correct_answer: 'up',
        explanation: '"Give up" means to stop trying or to surrender.',
        difficulty: 1,
      },
      {
        question_text:
          'What does "hit the nail on the head" mean?',
        question_type: 'mcq',
        options: [
          'To make a mistake',
          'To describe exactly what is right',
          'To hurt yourself',
          'To build furniture',
        ],
        correct_answer: 'To describe exactly what is right',
        explanation:
          '"Hit the nail on the head" means to be exactly correct about something.',
        difficulty: 3,
      },
      {
        question_text:
          'Fill in the blank: "I need to _____ out the details before we sign the contract." (to resolve / clarify)',
        question_type: 'fill_blank',
        correct_answer: 'work',
        explanation: '"Work out" can mean to resolve, clarify, or figure out details.',
        difficulty: 3,
      },
    ],
  },

  // ════════════════════════════════════════════
  //  JAPANESE QUIZZES
  // ════════════════════════════════════════════

  // 12 ── Japanese — Hiragana Vowels & K-row
  {
    title: 'Hiragana Basics Test',
    description:
      'Test your recognition of hiragana vowels (あ行) and k-row (か行) characters.',
    deckTitle: 'Japanese — Hiragana Vowels & K-row',
    time_limit_minutes: 6,
    questions: [
      {
        question_text: 'What is the romaji reading of the hiragana character "あ"?',
        question_type: 'mcq',
        options: ['ka', 'a', 'i', 'u'],
        correct_answer: 'a',
        explanation: '"あ" is the first character of the hiragana syllabary, pronounced "a".',
        difficulty: 1,
      },
      {
        question_text: 'The hiragana character "き" is read as "ki".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Write the romaji for "く": _____',
        question_type: 'fill_blank',
        correct_answer: 'ku',
        difficulty: 1,
      },
      {
        question_text: 'Which hiragana character represents the sound "ke"?',
        question_type: 'mcq',
        options: ['か', 'き', 'く', 'け'],
        correct_answer: 'け',
        explanation: 'か=ka, き=ki, く=ku, け=ke, こ=ko — this is the k-row order.',
        difficulty: 1,
      },
      {
        question_text: 'The vowel order in Japanese hiragana is: a, i, u, e, o.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'The Japanese vowel order is あ(a), い(i), う(u), え(e), お(o) — different from the English A-E-I-O-U.',
        difficulty: 1,
      },
      {
        question_text: 'Write the romaji for "こ": _____',
        question_type: 'fill_blank',
        correct_answer: 'ko',
        difficulty: 1,
      },
      {
        question_text: 'How many basic vowel sounds are there in Japanese?',
        question_type: 'mcq',
        options: ['3', '4', '5', '6'],
        correct_answer: '5',
        explanation: 'Japanese has five vowel sounds: a, i, u, e, o.',
        difficulty: 1,
      },
    ],
  },

  // 13 ── Japanese — JLPT N5 Core Vocabulary
  {
    title: 'JLPT N5 Vocabulary Challenge',
    description:
      'Essential Japanese vocabulary for JLPT N5 — the foundational level of Japanese proficiency.',
    deckTitle: 'Japanese — JLPT N5 Core Vocabulary',
    time_limit_minutes: 10,
    questions: [
      {
        question_text: 'What does "水" (みず / mizu) mean?',
        question_type: 'mcq',
        options: ['Fire', 'Water', 'Earth', 'Wind'],
        correct_answer: 'Water',
        difficulty: 1,
      },
      {
        question_text: '"本" (ほん / hon) means "book".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"本" is one of the first kanji learned; it means "book" and is also used as a counter for long, thin objects.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank with the English meaning: "先生" (せんせい / sensei) = _____',
        question_type: 'fill_blank',
        correct_answer: 'teacher',
        explanation: '"先生" literally means "one who was born before" and is used for teachers, doctors, and other respected professionals.',
        difficulty: 1,
      },
      {
        question_text: 'What does "大きい" (おおきい / ookii) mean?',
        question_type: 'mcq',
        options: ['Small', 'Big', 'Fast', 'Slow'],
        correct_answer: 'Big',
        explanation: '"大きい" means big/large. Its opposite is "小さい" (ちいさい / chiisai) meaning small.',
        difficulty: 1,
      },
      {
        question_text: '"友達" (ともだち / tomodachi) means "enemy".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"友達" means "friend". "敵" (てき / teki) means "enemy".',
        difficulty: 1,
      },
      {
        question_text: 'What does "食べ物" (たべもの / tabemono) mean?',
        question_type: 'mcq',
        options: ['Drink', 'Food', 'Animal', 'Place'],
        correct_answer: 'Food',
        explanation: '"食べ物" combines "食べ" (to eat) + "物" (thing) = "food".',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "電話" (でんわ / denwa) = _____ (a communication device)',
        question_type: 'fill_blank',
        correct_answer: 'telephone',
        difficulty: 2,
      },
      {
        question_text: 'What is the meaning of "天気" (てんき / tenki)?',
        question_type: 'mcq',
        options: ['Temperature', 'Weather', 'Season', 'Climate'],
        correct_answer: 'Weather',
        difficulty: 2,
      },
    ],
  },

  // 14 ── Japanese — JLPT N5 Common Verbs
  {
    title: 'Japanese Verb Basics',
    description:
      'Practice essential JLPT N5 verbs — meanings, conjugation awareness, and usage.',
    deckTitle: 'Japanese — JLPT N5 Common Verbs',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "食べる" (たべる / taberu) mean?',
        question_type: 'mcq',
        options: ['To drink', 'To eat', 'To sleep', 'To walk'],
        correct_answer: 'To eat',
        difficulty: 1,
      },
      {
        question_text: '"飲む" (のむ / nomu) means "to drink".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the English meaning: "行く" (いく / iku) = to _____',
        question_type: 'fill_blank',
        correct_answer: 'go',
        explanation: '"行く" is one of the most common Japanese verbs, meaning "to go".',
        difficulty: 1,
      },
      {
        question_text: 'What does "見る" (みる / miru) mean?',
        question_type: 'mcq',
        options: ['To hear', 'To touch', 'To see/watch', 'To smell'],
        correct_answer: 'To see/watch',
        difficulty: 1,
      },
      {
        question_text: '"書く" (かく / kaku) means "to read".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"書く" means "to write". "読む" (よむ / yomu) means "to read".',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the English meaning: "話す" (はなす / hanasu) = to _____',
        question_type: 'fill_blank',
        correct_answer: 'speak',
        explanation: '"話す" means "to speak" or "to talk".',
        difficulty: 2,
      },
      {
        question_text: 'Which verb means "to buy"?',
        question_type: 'mcq',
        options: [
          '売る (うる / uru)',
          '買う (かう / kau)',
          '会う (あう / au)',
          '使う (つかう / tsukau)',
        ],
        correct_answer: '買う (かう / kau)',
        explanation: '"買う" means "to buy"; "売る" means "to sell"; "会う" means "to meet".',
        difficulty: 2,
      },
    ],
  },

  // 15 ── Japanese — Daily Life Phrases & Restaurant & Shopping (combined)
  {
    title: 'Japanese Daily Life & Dining',
    description:
      'Everyday Japanese phrases for greetings, shopping, and dining out.',
    deckTitle: 'Japanese — Daily Life Phrases',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "いただきます" (itadakimasu) mean?',
        question_type: 'mcq',
        options: [
          'Thank you',
          'Excuse me',
          'A phrase said before eating (I humbly receive)',
          'Goodbye',
        ],
        correct_answer: 'A phrase said before eating (I humbly receive)',
        explanation:
          '"いただきます" is said before meals to express gratitude for the food.',
        difficulty: 2,
      },
      {
        question_text:
          '"すみません" (sumimasen) can be used both as "excuse me" and "I\'m sorry".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          '"すみません" is a versatile expression used to apologize, get attention, or express gratitude.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "おはよう_____" (formal morning greeting)',
        question_type: 'fill_blank',
        correct_answer: 'ございます',
        explanation:
          '"おはようございます" is the polite form of "good morning" in Japanese.',
        difficulty: 2,
      },
      {
        question_text: 'What does "お会計お願いします" (okaikei onegaishimasu) mean?',
        question_type: 'mcq',
        options: [
          'May I see the menu?',
          'Check, please.',
          'Another round, please.',
          'Where is the restroom?',
        ],
        correct_answer: 'Check, please.',
        explanation:
          '"お会計" means "the bill/check" and "お願いします" means "please".',
        difficulty: 3,
      },
      {
        question_text:
          '"ごちそうさまでした" (gochisousama deshita) is said after eating a meal.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'It expresses gratitude for the meal after eating, complementing "いただきます" which is said before.',
        difficulty: 2,
      },
      {
        question_text:
          'Fill in the blank: "これは_____ですか" (How much is this?)',
        question_type: 'fill_blank',
        correct_answer: 'いくら',
        explanation: '"いくら" means "how much" when asking about price.',
        difficulty: 2,
      },
    ],
  },

  // 16 ── Japanese — Katakana Essentials & JLPT N4 Adjectives
  {
    title: 'Katakana & Adjectives Quiz',
    description:
      'Test your knowledge of katakana loanwords and JLPT N4 level adjectives.',
    deckTitle: 'Japanese — Katakana Essentials',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What English word does "コンピュータ" (konpyuuta) represent?',
        question_type: 'mcq',
        options: ['Calculator', 'Computer', 'Controller', 'Communicator'],
        correct_answer: 'Computer',
        explanation: 'Katakana is used for foreign loanwords; "コンピュータ" comes from the English "computer".',
        difficulty: 1,
      },
      {
        question_text: '"テレビ" (terebi) comes from the English word "television".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'What English loanword is "レストラン" (resutoran)?',
        question_type: 'fill_blank',
        correct_answer: 'restaurant',
        difficulty: 1,
      },
      {
        question_text: 'What does "アイスクリーム" (aisukuriimu) mean?',
        question_type: 'mcq',
        options: ['Iced tea', 'Ice cream', 'Ice cube', 'Icing'],
        correct_answer: 'Ice cream',
        difficulty: 1,
      },
      {
        question_text: '"ホテル" (hoteru) is the katakana for "hotel".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "タクシー" (takushii) = _____ (a type of vehicle for hire)',
        question_type: 'fill_blank',
        correct_answer: 'taxi',
        difficulty: 1,
      },
      {
        question_text: 'Which katakana word means "coffee"?',
        question_type: 'mcq',
        options: ['カメラ', 'コーヒー', 'ケーキ', 'カレー'],
        correct_answer: 'コーヒー',
        explanation: 'コーヒー = coffee, カメラ = camera, ケーキ = cake, カレー = curry.',
        difficulty: 2,
      },
    ],
  },

  // 17 ── Japanese — Restaurant & Shopping
  {
    title: 'Japanese Restaurant & Shopping',
    description: 'Practice ordering food, asking prices, and shopping in Japanese.',
    deckTitle: 'Japanese — Restaurant & Shopping',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "メニューをください" (menyuu o kudasai) mean?',
        question_type: 'mcq',
        options: [
          'Please give me the check.',
          'Please give me the menu.',
          'Please give me water.',
          'Please give me a bag.',
        ],
        correct_answer: 'Please give me the menu.',
        explanation: '"メニュー" is the katakana for "menu" and "ください" means "please give me".',
        difficulty: 2,
      },
      {
        question_text: '"おすすめは何ですか" (osusume wa nan desu ka) means "What do you recommend?"',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"おすすめ" means "recommendation" — this is a very useful phrase in Japanese restaurants.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "_____ 一つお願いします" (One of this, please) — fill in the word for "this"',
        question_type: 'fill_blank',
        correct_answer: 'これ',
        explanation: '"これ" means "this" and is used when pointing at something nearby.',
        difficulty: 2,
      },
      {
        question_text: 'What does "試着してもいいですか" (shichaku shite mo ii desu ka) mean?',
        question_type: 'mcq',
        options: [
          'Can I get a discount?',
          'May I try this on?',
          'Do you have a bigger size?',
          'Is this on sale?',
        ],
        correct_answer: 'May I try this on?',
        explanation: '"試着" means "fitting/trying on clothes" — essential for shopping.',
        difficulty: 3,
      },
      {
        question_text: '"現金で払います" (genkin de haraimasu) means "I will pay by credit card."',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"現金" means "cash". "I will pay by credit card" would be "クレジットカードで払います".',
        difficulty: 3,
      },
      {
        question_text: 'Fill in the blank: "袋は_____ですか" (Are bags free?) — fill in the word for "free (of charge)"',
        question_type: 'fill_blank',
        correct_answer: '無料',
        explanation: '"無料" (むりょう / muryou) means "free of charge".',
        difficulty: 3,
      },
    ],
  },

  // ════════════════════════════════════════════
  //  CHINESE QUIZZES
  // ════════════════════════════════════════════

  // 18 ── Chinese — Pinyin Foundations
  {
    title: 'Pinyin Fundamentals',
    description:
      'Master the Chinese phonetic system — tones, initials, and finals that form the basis of Mandarin pronunciation.',
    deckTitle: 'Chinese — Pinyin Foundations',
    time_limit_minutes: 7,
    questions: [
      {
        question_text: 'How many tones does standard Mandarin Chinese have (including the neutral tone)?',
        question_type: 'mcq',
        options: ['3', '4', '5', '6'],
        correct_answer: '5',
        explanation:
          'Mandarin has 4 main tones plus a neutral (light) tone, totaling 5.',
        difficulty: 1,
      },
      {
        question_text: 'The first tone in Mandarin is a high, flat tone.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'The first tone (ˉ) is a high-level, flat tone maintained at a consistently high pitch.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the tone number: "mā" (mother) is tone _____.',
        question_type: 'fill_blank',
        correct_answer: '1',
        explanation: '"mā" with the flat macron is the first tone, meaning "mother" (妈).',
        difficulty: 1,
      },
      {
        question_text: 'Which pinyin represents the sound "sh" as in "shì" (是)?',
        question_type: 'mcq',
        options: ['s', 'x', 'sh', 'zh'],
        correct_answer: 'sh',
        explanation:
          '"sh" is a retroflex fricative, different from "s" (alveolar) and "x" (palatal).',
        difficulty: 2,
      },
      {
        question_text: 'In pinyin, "q" is pronounced like the English "ch" sound.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation:
          'The pinyin "q" is a palatal affricate, roughly similar to "ch" but with the tongue closer to the front of the mouth.',
        difficulty: 2,
      },
      {
        question_text: 'The third tone in Mandarin is described as a _____ tone (falling then rising).',
        question_type: 'fill_blank',
        correct_answer: 'dipping',
        explanation: 'The third tone dips down and then rises, often called the "dipping" tone.',
        difficulty: 2,
      },
      {
        question_text: 'Which pair of words demonstrates how tones change meaning?',
        question_type: 'mcq',
        options: [
          'mā (mother) vs. mǎ (horse)',
          'bā (eight) vs. bā (eight)',
          'shì (yes) vs. shì (yes)',
          'hǎo (good) vs. hǎo (good)',
        ],
        correct_answer: 'mā (mother) vs. mǎ (horse)',
        explanation: '"mā" (first tone) = mother; "mǎ" (third tone) = horse — demonstrating that tones distinguish meaning.',
        difficulty: 2,
      },
    ],
  },

  // 19 ── Chinese — HSK 1 Core Vocabulary
  {
    title: 'HSK 1 Vocabulary Test',
    description:
      'Essential HSK Level 1 words covering basic nouns, verbs, and everyday expressions.',
    deckTitle: 'Chinese — HSK 1 Core Vocabulary',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "你好" (nǐ hǎo) mean?',
        question_type: 'mcq',
        options: ['Goodbye', 'Thank you', 'Hello', 'Sorry'],
        correct_answer: 'Hello',
        explanation: '"你好" is the most basic Chinese greeting, literally meaning "you good".',
        difficulty: 1,
      },
      {
        question_text: '"谢谢" (xièxie) means "thank you".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the English meaning: "学生" (xuéshēng) = _____',
        question_type: 'fill_blank',
        correct_answer: 'student',
        explanation: '"学" means "to study" and "生" means "life/person", together meaning "student".',
        difficulty: 1,
      },
      {
        question_text: 'What does "吃" (chī) mean?',
        question_type: 'mcq',
        options: ['To drink', 'To eat', 'To cook', 'To sleep'],
        correct_answer: 'To eat',
        difficulty: 1,
      },
      {
        question_text: '"医生" (yīshēng) means "teacher".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"医生" means "doctor". "Teacher" is "老师" (lǎoshī).',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "我是中国_____" (I am Chinese) — fill in the word for "person"',
        question_type: 'fill_blank',
        correct_answer: '人',
        explanation: '"人" (rén) means "person/people". "中国人" = Chinese person.',
        difficulty: 1,
      },
      {
        question_text: 'What does "多少钱" (duōshao qián) mean?',
        question_type: 'mcq',
        options: ['What time is it?', 'How much money?', 'Where is it?', 'How old are you?'],
        correct_answer: 'How much money?',
        explanation: '"多少" = how much/many; "钱" = money. This phrase is essential for shopping.',
        difficulty: 2,
      },
      {
        question_text: '"家" (jiā) means "home" or "family".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
    ],
  },

  // 20 ── Chinese — HSK 2 Expansion
  {
    title: 'HSK 2 Vocabulary Expansion',
    description:
      'Build on HSK 1 with more complex vocabulary covering daily activities, travel, and descriptions.',
    deckTitle: 'Chinese — HSK 2 Expansion',
    time_limit_minutes: 10,
    questions: [
      {
        question_text: 'What does "已经" (yǐjīng) mean?',
        question_type: 'mcq',
        options: ['Maybe', 'Already', 'Never', 'Sometimes'],
        correct_answer: 'Already',
        explanation: '"已经" is an adverb meaning "already", often used with "了" to indicate a completed action.',
        difficulty: 2,
      },
      {
        question_text: '"因为" (yīnwèi) is used to express a reason or cause.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"因为" means "because" and is often paired with "所以" (suǒyǐ = therefore).',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "我_____ 去过中国" (I have been to China) — fill in the word for "already"',
        question_type: 'fill_blank',
        correct_answer: '已经',
        difficulty: 3,
      },
      {
        question_text: 'What does "准备" (zhǔnbèi) mean?',
        question_type: 'mcq',
        options: ['To forget', 'To prepare', 'To remember', 'To arrive'],
        correct_answer: 'To prepare',
        difficulty: 2,
      },
      {
        question_text: '"旁边" (pángbiān) means "inside".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"旁边" means "beside/next to". "Inside" is "里面" (lǐmiàn).',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the English meaning: "可能" (kěnéng) = _____',
        question_type: 'fill_blank',
        correct_answer: 'maybe',
        explanation: '"可能" means "maybe" or "possibly" and is used to express uncertainty.',
        difficulty: 2,
      },
      {
        question_text: 'Which word means "to think / to believe"?',
        question_type: 'mcq',
        options: [
          '觉得 (juéde)',
          '知道 (zhīdào)',
          '告诉 (gàosù)',
          '帮助 (bāngzhù)',
        ],
        correct_answer: '觉得 (juéde)',
        explanation: '"觉得" means "to feel/think/believe"; "知道" = to know; "告诉" = to tell; "帮助" = to help.',
        difficulty: 3,
      },
    ],
  },

  // 21 ── Chinese — Numbers & Time + Food & Dining
  {
    title: 'Chinese Numbers, Time & Food',
    description:
      'Practice Chinese numbers, telling time, and essential food vocabulary.',
    deckTitle: 'Chinese — Numbers & Time',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What is the Chinese character for the number 3?',
        question_type: 'mcq',
        options: ['一', '二', '三', '四'],
        correct_answer: '三',
        explanation: '一=1, 二=2, 三=3, 四=4. The characters for 1-3 use horizontal strokes.',
        difficulty: 1,
      },
      {
        question_text: '"百" (bǎi) means "hundred".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "现在_____ 点" (It is now ___ o\'clock) — write the character for the number 5',
        question_type: 'fill_blank',
        correct_answer: '五',
        difficulty: 1,
      },
      {
        question_text: 'How do you say "3:30" in Chinese?',
        question_type: 'mcq',
        options: [
          '三点三十分',
          '三十三点',
          '三点十三分',
          '十三点三分',
        ],
        correct_answer: '三点三十分',
        explanation: '"三点" = 3 o\'clock; "三十分" = 30 minutes. You can also say "三点半" (half past three).',
        difficulty: 2,
      },
      {
        question_text: '"星期一" (xīngqī yī) means "Monday".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'Days of the week in Chinese use "星期" + a number (1-6), with Sunday being "星期天" or "星期日".',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "_____ 月" means "January" — fill in the number character',
        question_type: 'fill_blank',
        correct_answer: '一',
        explanation: 'Months in Chinese are simply the number + 月 (month): 一月 = January, 二月 = February, etc.',
        difficulty: 1,
      },
      {
        question_text: 'What number does "十" (shí) represent?',
        question_type: 'mcq',
        options: ['4', '7', '10', '100'],
        correct_answer: '10',
        difficulty: 1,
      },
    ],
  },

  // 22 ── Chinese — HSK 3 Intermediate + Food & Dining
  {
    title: 'HSK 3 & Chinese Dining',
    description:
      'Intermediate Chinese vocabulary from HSK 3 combined with essential food and dining expressions.',
    deckTitle: 'Chinese — Chinese Food & Dining',
    time_limit_minutes: 10,
    questions: [
      {
        question_text: 'What does "筷子" (kuàizi) mean?',
        question_type: 'mcq',
        options: ['Spoon', 'Fork', 'Chopsticks', 'Knife'],
        correct_answer: 'Chopsticks',
        explanation: '"筷子" are the traditional eating utensils used in Chinese cuisine.',
        difficulty: 1,
      },
      {
        question_text: '"服务员" (fúwùyuán) means "waiter/waitress".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"服务" means "service" and "员" means "person/member" — a service person = waiter.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "我要一碗_____ " (I want a bowl of rice) — fill in the word for "rice"',
        question_type: 'fill_blank',
        correct_answer: '米饭',
        explanation: '"米饭" (mǐfàn) means "cooked rice" — the staple food in Chinese cuisine.',
        difficulty: 2,
      },
      {
        question_text: 'What does "买单" (mǎidān) mean in a restaurant?',
        question_type: 'mcq',
        options: [
          'Order food',
          'Pay the bill',
          'Make a reservation',
          'Ask for the menu',
        ],
        correct_answer: 'Pay the bill',
        explanation: '"买单" literally means "buy the bill" and is how you ask for the check in China.',
        difficulty: 2,
      },
      {
        question_text: '"辣" (là) means "sweet".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"辣" means "spicy/hot". "Sweet" is "甜" (tián).',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "不要放_____ " (Don\'t add MSG) — fill in the word for MSG',
        question_type: 'fill_blank',
        correct_answer: '味精',
        explanation: '"味精" (wèijīng) means "MSG" (monosodium glutamate), a common flavor enhancer.',
        difficulty: 3,
      },
      {
        question_text: 'Which dish is "宫保鸡丁" (gōngbǎo jīdīng)?',
        question_type: 'mcq',
        options: [
          'Sweet and Sour Pork',
          'Kung Pao Chicken',
          'Peking Duck',
          'Mapo Tofu',
        ],
        correct_answer: 'Kung Pao Chicken',
        explanation: '"宫保鸡丁" is the famous Sichuan dish Kung Pao Chicken, made with chicken, peanuts, and chili peppers.',
        difficulty: 2,
      },
      {
        question_text: '"饺子" (jiǎozi) are Chinese dumplings.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
    ],
  },

  // ════════════════════════════════════════════
  //  KOREAN QUIZZES
  // ════════════════════════════════════════════

  // 23 ── Korean — Hangul Vowels & Consonants
  {
    title: 'Hangul Fundamentals',
    description:
      'Test your knowledge of Korean Hangul — vowels, consonants, and syllable formation.',
    deckTitle: 'Korean — Hangul Vowels & Consonants',
    time_limit_minutes: 7,
    questions: [
      {
        question_text: 'How many basic vowel letters are there in the Korean Hangul system?',
        question_type: 'mcq',
        options: ['8', '10', '14', '21'],
        correct_answer: '10',
        explanation: 'Hangul has 10 basic vowels (ㅏ, ㅑ, ㅓ, ㅕ, ㅗ, ㅛ, ㅜ, ㅠ, ㅡ, ㅣ) and 14 basic consonants.',
        difficulty: 2,
      },
      {
        question_text: 'The consonant "ㄱ" is pronounced similar to "g" or "k" in English.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"ㄱ" sounds like "g" at the beginning of a word and "k" at the end of a syllable.',
        difficulty: 1,
      },
      {
        question_text: 'What sound does the vowel "ㅏ" make?',
        question_type: 'fill_blank',
        correct_answer: 'a',
        explanation: '"ㅏ" is pronounced like "a" in "father".',
        difficulty: 1,
      },
      {
        question_text: 'Which consonant is silent when it appears at the beginning of a syllable?',
        question_type: 'mcq',
        options: ['ㄴ', 'ㅇ', 'ㅁ', 'ㄹ'],
        correct_answer: 'ㅇ',
        explanation: '"ㅇ" is silent as an initial consonant (placeholder) but pronounced "ng" as a final consonant (받침).',
        difficulty: 2,
      },
      {
        question_text: 'Korean syllables can only be written horizontally.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: 'Korean syllable blocks can be arranged both horizontally and vertically depending on the vowel used.',
        difficulty: 2,
      },
      {
        question_text: 'How many basic consonant letters are there in Hangul?',
        question_type: 'mcq',
        options: ['10', '12', '14', '19'],
        correct_answer: '14',
        explanation: 'Hangul has 14 basic consonants: ㄱ, ㄴ, ㄷ, ㄹ, ㅁ, ㅂ, ㅅ, ㅇ, ㅈ, ㅊ, ㅋ, ㅌ, ㅍ, ㅎ.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the romanization: "한" = _____',
        question_type: 'fill_blank',
        correct_answer: 'han',
        explanation: 'ㅎ(h) + ㅏ(a) + ㄴ(n) = "han", as in "한글" (Hangul).',
        difficulty: 2,
      },
    ],
  },

  // 24 ── Korean — TOPIK 1 Daily Words & Greetings
  {
    title: 'Korean Daily Words & Greetings',
    description:
      'Essential Korean vocabulary for daily life, polite expressions, and basic conversation.',
    deckTitle: 'Korean — TOPIK 1 Daily Words',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "감사합니다" (gamsahamnida) mean?',
        question_type: 'mcq',
        options: ['Hello', 'Goodbye', 'Thank you', 'Sorry'],
        correct_answer: 'Thank you',
        explanation: '"감사합니다" is the formal way to say "thank you" in Korean.',
        difficulty: 1,
      },
      {
        question_text: '"안녕하세요" (annyeonghaseyo) is used as both "hello" and "how are you?".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"안녕하세요" literally means "Are you at peace?" and serves as a general greeting.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the English meaning: "학교" (hakgyo) = _____',
        question_type: 'fill_blank',
        correct_answer: 'school',
        explanation: '"학" means "study/learning" and "교" means "teaching" — together they form "school".',
        difficulty: 1,
      },
      {
        question_text: 'What does "물" (mul) mean?',
        question_type: 'mcq',
        options: ['Fire', 'Water', 'Earth', 'Air'],
        correct_answer: 'Water',
        difficulty: 1,
      },
      {
        question_text: '"죄송합니다" (joesonghamnida) means "I\'m sorry" (formal).',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"죄송합니다" is the formal apology, while "미안해요" (mianhaeyo) is less formal.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "_____ 주세요" means "Please give me water" — fill in the Korean word for "water"',
        question_type: 'fill_blank',
        correct_answer: '물',
        explanation: '"물 주세요" (mul juseyo) = "Water, please" — very useful in restaurants.',
        difficulty: 2,
      },
      {
        question_text: 'What does "맛있어요" (masisseoyo) mean?',
        question_type: 'mcq',
        options: [
          'It\'s expensive',
          'It\'s delicious',
          'It\'s beautiful',
          'It\'s difficult',
        ],
        correct_answer: 'It\'s delicious',
        explanation: '"맛" means "taste" and "있어요" means "exists/has" — literally "has taste" = delicious.',
        difficulty: 2,
      },
      {
        question_text: '"사랑해요" (saranghaeyo) means "I love you".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 1,
      },
    ],
  },

  // 25 ── Korean — Greetings & Polite Forms
  {
    title: 'Korean Politeness Levels',
    description:
      'Understand Korean honorifics and polite speech forms essential for respectful communication.',
    deckTitle: 'Korean — Greetings & Polite Forms',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'Which speech level is the most formal in Korean?',
        question_type: 'mcq',
        options: [
          '반말 (banmal) — casual speech',
          '해요체 (haeyoche) — polite informal',
          '합쇼체 (hapshoche) — formal polite',
          '해체 (haeche) — intimate speech',
        ],
        correct_answer: '합쇼체 (hapshoche) — formal polite',
        explanation: '합쇼체 is the highest level of politeness, used in formal settings, news broadcasts, and with elders.',
        difficulty: 3,
      },
      {
        question_text: 'Adding "요" (yo) to the end of a sentence makes it more polite.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'The "요" ending converts casual speech into polite informal speech (해요체), the most commonly used level.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "안녕히 _____" (Goodbye — said to someone who is leaving)',
        question_type: 'fill_blank',
        correct_answer: '가세요',
        explanation: '"안녕히 가세요" = "Go peacefully" (said to the person leaving). "안녕히 계세요" = said to the person staying.',
        difficulty: 2,
      },
      {
        question_text: 'What does "존댓말" (jondaenmal) refer to?',
        question_type: 'mcq',
        options: [
          'Casual speech between friends',
          'Formal/polite speech',
          'Written Korean only',
          'Slang expressions',
        ],
        correct_answer: 'Formal/polite speech',
        explanation: '"존댓말" is the umbrella term for polite/honorific speech levels in Korean.',
        difficulty: 3,
      },
      {
        question_text: 'It is appropriate to use 반말 (casual speech) when speaking to someone older than you for the first time.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: 'Using 반말 with someone older or of higher status is considered very rude. Always use 존댓말 until invited to speak casually.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "처음 _____" (Nice to meet you — formal) — fill in the common ending',
        question_type: 'fill_blank',
        correct_answer: '뵙겠습니다',
        explanation: '"처음 뵙겠습니다" (cheoeum boepgesseumnida) is the formal way to say "Nice to meet you".',
        difficulty: 4,
      },
    ],
  },

  // 26 ── Korean — Korean Numbers
  {
    title: 'Korean Number Systems',
    description:
      'Learn both the native Korean (하나, 둘, 셋...) and Sino-Korean (일, 이, 삼...) number systems.',
    deckTitle: 'Korean — Korean Numbers',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'Korean uses two number systems: native Korean and Sino-Korean.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'Native Korean numbers (하나, 둘, 셋...) are used for counting and age; Sino-Korean numbers (일, 이, 삼...) are used for dates, phone numbers, and money.',
        difficulty: 2,
      },
      {
        question_text: 'What is "하나" (hana) in numbers?',
        question_type: 'mcq',
        options: ['1', '2', '3', '5'],
        correct_answer: '1',
        explanation: '"하나" is "one" in the native Korean number system.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "_____, 이, 삼, 사, 오" (1, 2, 3, 4, 5 in Sino-Korean)',
        question_type: 'fill_blank',
        correct_answer: '일',
        explanation: '"일" (il) is "one" in the Sino-Korean number system.',
        difficulty: 1,
      },
      {
        question_text: 'Which number system is used for telling age in Korean?',
        question_type: 'mcq',
        options: [
          'Sino-Korean numbers',
          'Native Korean numbers',
          'English numbers',
          'Both systems equally',
        ],
        correct_answer: 'Native Korean numbers',
        explanation: 'Age is expressed with native Korean numbers + 살 (sal): 스물한 살 = 21 years old.',
        difficulty: 3,
      },
      {
        question_text: '"열" (yeol) means "ten" in native Korean numbers.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "사과 _____ 개 주세요" (Please give me 3 apples) — use native Korean number',
        question_type: 'fill_blank',
        correct_answer: '세',
        explanation: '"셋" becomes "세" before a counter. "세 개" = three items.',
        difficulty: 3,
      },
      {
        question_text: 'Which number system is used for money in Korean?',
        question_type: 'mcq',
        options: [
          'Native Korean only',
          'Sino-Korean only',
          'Both equally',
          'Neither — English is used',
        ],
        correct_answer: 'Sino-Korean only',
        explanation: 'Money amounts use Sino-Korean numbers: 오천 원 (ocheon won) = 5,000 won.',
        difficulty: 2,
      },
    ],
  },

  // ════════════════════════════════════════════
  //  VIETNAMESE QUIZZES
  // ════════════════════════════════════════════

  // 27 ── Vietnamese — Survival Phrases for Travelers
  {
    title: 'Vietnamese Travel Survival',
    description:
      'Essential Vietnamese phrases for tourists — greetings, directions, shopping, and emergencies.',
    deckTitle: 'Vietnamese — Survival Phrases for Travelers',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What does "Xin chào" mean in Vietnamese?',
        question_type: 'mcq',
        options: ['Goodbye', 'Thank you', 'Hello', 'Sorry'],
        correct_answer: 'Hello',
        explanation: '"Xin chào" is the standard greeting in Vietnamese, suitable for most situations.',
        difficulty: 1,
      },
      {
        question_text: '"Cảm ơn" means "thank you" in Vietnamese.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"Cảm ơn" (or "cảm ơn bạn" for "thank you, friend") is the standard expression of gratitude.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "Bao nhiêu _____?" (How much money?) — fill in the word for "money"',
        question_type: 'fill_blank',
        correct_answer: 'tiền',
        explanation: '"Bao nhiêu tiền?" is essential for shopping in Vietnam.',
        difficulty: 2,
      },
      {
        question_text: 'How do you say "Where is the restroom?" in Vietnamese?',
        question_type: 'mcq',
        options: [
          'Tôi muốn ăn.',
          'Nhà vệ sinh ở đâu?',
          'Bạn tên gì?',
          'Tôi không hiểu.',
        ],
        correct_answer: 'Nhà vệ sinh ở đâu?',
        explanation: '"Nhà vệ sinh" = restroom; "ở đâu" = where is. This is one of the most important phrases for travelers.',
        difficulty: 2,
      },
      {
        question_text: '"Tôi không hiểu" means "I understand".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'False',
        explanation: '"Tôi không hiểu" means "I don\'t understand". "Không" negates the verb. "I understand" is "Tôi hiểu".',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "Tôi _____ đi Hà Nội" (I want to go to Hanoi) — fill in the word for "want"',
        question_type: 'fill_blank',
        correct_answer: 'muốn',
        explanation: '"Muốn" means "to want" and is used in many practical travel sentences.',
        difficulty: 2,
      },
      {
        question_text: 'What does "Xin lỗi" mean?',
        question_type: 'mcq',
        options: ['Hello', 'Please', 'Excuse me / Sorry', 'Help'],
        correct_answer: 'Excuse me / Sorry',
        explanation: '"Xin lỗi" is used to apologize or to get someone\'s attention politely.',
        difficulty: 1,
      },
      {
        question_text: '"Vâng" (in Northern Vietnamese) and "Dạ" (in Southern Vietnamese) both mean "yes".',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'Vietnam has regional variations: "Vâng" is used in the North and "Dạ" in the South for polite agreement.',
        difficulty: 3,
      },
    ],
  },

  // 28 ── Vietnamese — Vietnamese Food & Drinks
  {
    title: 'Vietnamese Food & Drinks',
    description:
      'Discover the vocabulary of Vietnamese cuisine — from phở to cà phê sữa đá.',
    deckTitle: 'Vietnamese — Vietnamese Food & Drinks',
    time_limit_minutes: 8,
    questions: [
      {
        question_text: 'What is "phở"?',
        question_type: 'mcq',
        options: [
          'A type of fried rice',
          'A traditional Vietnamese noodle soup',
          'A Vietnamese dessert',
          'A type of spring roll',
        ],
        correct_answer: 'A traditional Vietnamese noodle soup',
        explanation: 'Phở is Vietnam\'s most famous dish — a fragrant soup with rice noodles, herbs, and usually beef or chicken.',
        difficulty: 1,
      },
      {
        question_text: '"Bánh mì" is a Vietnamese sandwich made with a French-style baguette.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'Bánh mì reflects French colonial influence — a crispy baguette filled with Vietnamese ingredients like pâté, pickled vegetables, and cilantro.',
        difficulty: 1,
      },
      {
        question_text: 'Fill in the blank: "Cà phê sữa _____" (Vietnamese iced coffee with milk) — fill in the word for "ice"',
        question_type: 'fill_blank',
        correct_answer: 'đá',
        explanation: '"Cà phê sữa đá" literally means "coffee milk ice" — Vietnam\'s iconic iced coffee drink.',
        difficulty: 2,
      },
      {
        question_text: 'What are "gỏi cuốn"?',
        question_type: 'mcq',
        options: [
          'Fried spring rolls',
          'Fresh spring rolls (summer rolls)',
          'Sticky rice cakes',
          'Grilled meat skewers',
        ],
        correct_answer: 'Fresh spring rolls (summer rolls)',
        explanation: '"Gỏi cuốn" are fresh (unfried) spring rolls wrapped in rice paper with shrimp, herbs, and vermicelli. Fried rolls are "chả giò".',
        difficulty: 2,
      },
      {
        question_text: '"Nước mắm" is Vietnamese fish sauce.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: '"Nước mắm" is the essential condiment in Vietnamese cooking, made from fermented fish and salt.',
        difficulty: 2,
      },
      {
        question_text: 'Fill in the blank: "Cho tôi một _____ phở bò" (Give me one bowl of beef phở) — fill in the word for "bowl"',
        question_type: 'fill_blank',
        correct_answer: 'tô',
        explanation: '"Tô" is the Vietnamese word for "bowl" (large bowl), commonly used when ordering soup dishes.',
        difficulty: 3,
      },
      {
        question_text: 'What does "Không cay" mean when ordering food?',
        question_type: 'mcq',
        options: [
          'Extra spicy',
          'Not spicy',
          'Very sweet',
          'No sugar',
        ],
        correct_answer: 'Not spicy',
        explanation: '"Không" means "no/not" and "cay" means "spicy". This is very useful when ordering food in Vietnam.',
        difficulty: 2,
      },
      {
        question_text: '"Bún chả" originated in Hanoi.',
        question_type: 'true_false',
        options: ['True', 'False'],
        correct_answer: 'True',
        explanation: 'Bún chả is a Hanoi specialty consisting of grilled pork served with rice noodles and fresh herbs. It gained international fame after Barack Obama ate it in Hanoi in 2016.',
        difficulty: 3,
      },
    ],
  },
];
