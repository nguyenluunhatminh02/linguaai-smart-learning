// ---------------------------------------------------------------------------
// Seed data – Content Items (Reading, Listening, Grammar)
// ---------------------------------------------------------------------------

export interface SeedContentQuestion {
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
}

export interface SeedContentItem {
  type: 'reading' | 'listening' | 'grammar';
  title: string;
  title_vi: string;
  level: string;
  category: string;
  content: string;
  data?: Record<string, unknown>;
  questions: SeedContentQuestion[];
  duration: string;
  word_count: number;
  audio_url?: string;
  sort_order: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

// ── Reading Passages ───────────────────────────────────────────────────────

const READING_MORNING_ROUTINE: SeedContentItem = {
  type: 'reading',
  title: 'Morning Routine',
  title_vi: 'Thói quen buổi sáng',
  level: 'A1',
  category: 'daily_life',
  content: `Every morning I wake up at seven o'clock. I brush my teeth and wash my face. Then I go to the kitchen. I eat bread and drink a glass of milk for breakfast. Sometimes I eat eggs too. After breakfast I put on my clothes and pick up my bag. I walk to the bus stop. The bus comes at eight o'clock. I ride the bus to school. My school starts at half past eight. I like mornings because they are quiet and fresh. My favourite part of the morning is breakfast with my family.`,
  questions: [
    {
      question: 'What time does the narrator wake up?',
      options: ['6:00', '7:00', '7:30', '8:00'],
      answer: '7:00',
      explanation: 'The text says "I wake up at seven o\'clock."',
    },
    {
      question: 'What does the narrator eat for breakfast?',
      options: [
        'Rice and soup',
        'Bread and milk',
        'Cereal and juice',
        'Pancakes and coffee',
      ],
      answer: 'Bread and milk',
      explanation:
        'The text mentions "I eat bread and drink a glass of milk for breakfast."',
    },
    {
      question: 'How does the narrator go to school?',
      options: ['By car', 'By bicycle', 'By bus', 'On foot'],
      answer: 'By bus',
      explanation: 'The narrator says "I ride the bus to school."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 1,
};
READING_MORNING_ROUTINE.word_count = countWords(
  READING_MORNING_ROUTINE.content,
);

const READING_AT_THE_SUPERMARKET: SeedContentItem = {
  type: 'reading',
  title: 'At the Supermarket',
  title_vi: 'Ở siêu thị',
  level: 'A1',
  category: 'shopping',
  content: `Today I go to the supermarket with my mother. We need to buy food for the week. First, we get a shopping cart. We walk to the fruit section. We pick apples, bananas, and oranges. Then we go to the vegetable section. We choose carrots, tomatoes, and lettuce. My mother also buys chicken and fish from the meat section. We need milk, cheese, and eggs from the dairy section. I want some cookies, but my mother says only one pack. We go to the checkout. The total is twenty-five dollars. My mother pays with her card. We carry the bags to the car and drive home.`,
  questions: [
    {
      question: 'Who does the narrator go shopping with?',
      options: ['Father', 'Mother', 'Friend', 'Sister'],
      answer: 'Mother',
      explanation: 'The text says "I go to the supermarket with my mother."',
    },
    {
      question: 'Which fruit do they NOT buy?',
      options: ['Apples', 'Bananas', 'Grapes', 'Oranges'],
      answer: 'Grapes',
      explanation:
        'The text mentions apples, bananas, and oranges. Grapes are not mentioned.',
    },
    {
      question: 'How much is the total?',
      options: ['$15', '$20', '$25', '$30'],
      answer: '$25',
      explanation: 'The text says "The total is twenty-five dollars."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 2,
};
READING_AT_THE_SUPERMARKET.word_count = countWords(
  READING_AT_THE_SUPERMARKET.content,
);

const READING_MY_PET: SeedContentItem = {
  type: 'reading',
  title: 'My Pet',
  title_vi: 'Thú cưng của tôi',
  level: 'A1',
  category: 'animals',
  content: `I have a pet dog. His name is Max. He is three years old. Max is brown and white. He is not very big, but he is not small either. Max likes to play in the garden. He runs very fast. Every day I take Max for a walk in the park. He loves to chase squirrels, but he never catches them. Max eats dog food twice a day. He also likes treats. When I come home from school, Max is always happy to see me. He jumps and wags his tail. At night Max sleeps on a bed next to mine. He is my best friend.`,
  questions: [
    {
      question: 'What kind of pet does the narrator have?',
      options: ['A cat', 'A dog', 'A bird', 'A fish'],
      answer: 'A dog',
      explanation: 'The text begins with "I have a pet dog."',
    },
    {
      question: 'What does Max like to chase in the park?',
      options: ['Cats', 'Balls', 'Squirrels', 'Birds'],
      answer: 'Squirrels',
      explanation: 'The text says "He loves to chase squirrels."',
    },
    {
      question: 'How often does Max eat?',
      options: [
        'Once a day',
        'Twice a day',
        'Three times a day',
        'Whenever he wants',
      ],
      answer: 'Twice a day',
      explanation: 'The text says "Max eats dog food twice a day."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 3,
};
READING_MY_PET.word_count = countWords(READING_MY_PET.content);

const READING_A_GIFT_FOR_MUM: SeedContentItem = {
  type: 'reading',
  title: 'A Gift for Mum',
  title_vi: 'Món quà cho mẹ',
  level: 'A2',
  category: 'family',
  content: `Next Sunday is Mother's Day. I want to give my mum a special gift. I talked to my sister about it last night. We decided to make breakfast in bed for her. We planned the menu carefully. We are going to cook scrambled eggs, toast, and fresh orange juice. My sister will also pick some flowers from the garden and put them in a vase. I am going to write a card with a poem inside. We need to wake up early, before Mum gets up. That means setting an alarm for six o'clock. I went to the shop yesterday and bought the ingredients. I also found a beautiful card with roses on the front. I practiced cracking eggs because I broke one on the floor last time. My sister laughed at me, but now I can do it perfectly. We both feel excited. Mum does so much for us every day, and we want to show her how much we love her. I think she will be very surprised and happy.`,
  questions: [
    {
      question: 'When is Mother\'s Day in the story?',
      options: ['Next Saturday', 'Next Sunday', 'Tomorrow', 'Today'],
      answer: 'Next Sunday',
      explanation: 'The text begins with "Next Sunday is Mother\'s Day."',
    },
    {
      question: 'What will they make for breakfast?',
      options: [
        'Pancakes and coffee',
        'Cereal and milk',
        'Scrambled eggs, toast, and orange juice',
        'Omelette and tea',
      ],
      answer: 'Scrambled eggs, toast, and orange juice',
      explanation:
        'The text says "We are going to cook scrambled eggs, toast, and fresh orange juice."',
    },
    {
      question: 'Why did the narrator practice cracking eggs?',
      options: [
        'To impress friends',
        'Because they broke one on the floor before',
        'For a cooking class',
        'Because Mum asked them to',
      ],
      answer: 'Because they broke one on the floor before',
      explanation:
        'The text says "I practiced cracking eggs because I broke one on the floor last time."',
    },
    {
      question: 'What time will they set the alarm?',
      options: ['5:00', '5:30', '6:00', '6:30'],
      answer: '6:00',
      explanation: 'The text says "setting an alarm for six o\'clock."',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 4,
};
READING_A_GIFT_FOR_MUM.word_count = countWords(READING_A_GIFT_FOR_MUM.content);

const READING_TRAVEL_BLOG: SeedContentItem = {
  type: 'reading',
  title: 'Travel Blog',
  title_vi: 'Nhật ký du lịch',
  level: 'A2',
  category: 'travel',
  content: `Last summer, my family and I visited Da Nang, a beautiful city in central Vietnam. We stayed at a hotel near the beach for five days. On the first day, we swam in the sea and built sandcastles. The water was warm and clear. On the second day, we went to the Marble Mountains. We climbed many steps to reach the top. The view was amazing — we could see the whole city and the ocean. On the third day, we visited the Dragon Bridge at night. The dragon breathed fire and water! It was so exciting. We also ate a lot of delicious food. I tried mi quang, a local noodle dish. It was spicy but very tasty. My parents enjoyed the seafood, especially the grilled prawns. On our last day, we bought souvenirs at Han Market. I got a small lantern and a T-shirt. I want to visit Da Nang again next year. It was the best holiday of my life.`,
  questions: [
    {
      question: 'Where did the family travel to?',
      options: ['Ha Noi', 'Ho Chi Minh City', 'Da Nang', 'Hue'],
      answer: 'Da Nang',
      explanation: 'The text says "my family and I visited Da Nang."',
    },
    {
      question: 'How long did they stay?',
      options: ['3 days', '4 days', '5 days', '7 days'],
      answer: '5 days',
      explanation:
        'The text says "We stayed at a hotel near the beach for five days."',
    },
    {
      question: 'What local dish did the narrator try?',
      options: ['Pho', 'Bun bo Hue', 'Mi quang', 'Com tam'],
      answer: 'Mi quang',
      explanation: 'The text says "I tried mi quang, a local noodle dish."',
    },
    {
      question: 'What did the narrator buy at Han Market?',
      options: [
        'A hat and a bag',
        'A lantern and a T-shirt',
        'A painting and a cup',
        'A keychain and a dress',
      ],
      answer: 'A lantern and a T-shirt',
      explanation:
        'The text says "I got a small lantern and a T-shirt."',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 5,
};
READING_TRAVEL_BLOG.word_count = countWords(READING_TRAVEL_BLOG.content);

const READING_WEEKEND_PLANS: SeedContentItem = {
  type: 'reading',
  title: 'Weekend Plans',
  title_vi: 'Kế hoạch cuối tuần',
  level: 'A2',
  category: 'daily_life',
  content: `Hi Emma! How are you? I'm writing to tell you about my plans for this weekend. On Saturday morning, I'm going to the gym with my friend Tom. We usually spend about one hour there. After that, we are going to have brunch at a new café near the park. I heard they make excellent pancakes. In the afternoon, I need to study for my English test on Monday. I haven't finished reading the chapter about past tenses yet. On Saturday evening, my roommates and I are going to watch a movie at home. We haven't decided which one yet, but I want to watch a comedy. On Sunday, I'm going to visit my grandparents. They live about thirty minutes from here by train. My grandmother is going to cook her famous roast chicken. I always look forward to her cooking. In the evening, I need to do my laundry and prepare my bag for Monday. It's going to be a busy but fun weekend! What about you? Do you have any plans? Write back soon! — Lisa`,
  questions: [
    {
      question: 'Who is Lisa going to the gym with?',
      options: ['Emma', 'Tom', 'Her roommate', 'Her sister'],
      answer: 'Tom',
      explanation: 'The text says "I\'m going to the gym with my friend Tom."',
    },
    {
      question: 'Why does Lisa need to study on Saturday afternoon?',
      options: [
        'She has a French test',
        'She has an English test on Monday',
        'She has homework due Sunday',
        'She has a job interview',
      ],
      answer: 'She has an English test on Monday',
      explanation:
        'The text says "I need to study for my English test on Monday."',
    },
    {
      question: 'How do Lisa\'s grandparents live from her?',
      options: [
        '10 minutes by bus',
        '20 minutes by car',
        '30 minutes by train',
        '1 hour by train',
      ],
      answer: '30 minutes by train',
      explanation:
        'The text says "They live about thirty minutes from here by train."',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 6,
};
READING_WEEKEND_PLANS.word_count = countWords(READING_WEEKEND_PLANS.content);

const READING_SUNDAY_FAMILY_DINNER: SeedContentItem = {
  type: 'reading',
  title: 'Sunday Family Dinner',
  title_vi: 'Bữa tối gia đình ngày Chủ nhật',
  level: 'B1',
  category: 'family',
  content: `In many cultures around the world, Sunday dinner is a cherished tradition that brings families together. In our family, this weekly gathering has been a tradition for as long as I can remember. Every Sunday afternoon, my mother begins preparing the meal at around two o'clock. She usually cooks a roast — sometimes beef, sometimes lamb — with roasted potatoes and seasonal vegetables. The kitchen fills with wonderful aromas that make everyone hungry long before dinner is ready.

My father's job is to set the table. He always uses the good plates, the ones we keep for special occasions, because he believes every family dinner is special. My brother usually arrives last, often bringing a dessert from the bakery down the street. His favourite is chocolate cake, though he sometimes surprises us with apple pie.

We sit down to eat at around five o'clock. During dinner, we talk about our week — the good things and the difficult things. My parents share stories from their childhood, and my brother and I share news about our jobs and friends. Nobody is allowed to use their phone at the table, which I think is a good rule.

After dinner, we clear the table together and wash the dishes. Then we often play a board game or watch a film. These Sunday dinners are the highlight of my week. In our busy modern lives, it is easy to lose touch with the people we love most. Having a fixed time to come together reminds us of what truly matters.`,
  questions: [
    {
      question: 'What time does the mother start cooking?',
      options: ['12:00', '1:00', '2:00', '3:00'],
      answer: '2:00',
      explanation:
        'The text says "my mother begins preparing the meal at around two o\'clock."',
    },
    {
      question: 'What is the father responsible for?',
      options: [
        'Cooking the meat',
        'Buying dessert',
        'Setting the table',
        'Washing the dishes',
      ],
      answer: 'Setting the table',
      explanation: 'The text says "My father\'s job is to set the table."',
    },
    {
      question: 'What rule exists during dinner?',
      options: [
        'No talking about work',
        'No phones at the table',
        'Everyone must finish their food',
        'Children eat first',
      ],
      answer: 'No phones at the table',
      explanation:
        'The text says "Nobody is allowed to use their phone at the table."',
    },
    {
      question:
        'According to the narrator, why are Sunday dinners important?',
      options: [
        'The food is always excellent',
        'They help family stay connected in busy lives',
        'The mother insists on them',
        'It is a religious obligation',
      ],
      answer: 'They help family stay connected in busy lives',
      explanation:
        'The final paragraph explains that a fixed gathering time "reminds us of what truly matters."',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 7,
};
READING_SUNDAY_FAMILY_DINNER.word_count = countWords(
  READING_SUNDAY_FAMILY_DINNER.content,
);

const READING_JOB_INTERVIEW_TIPS: SeedContentItem = {
  type: 'reading',
  title: 'Job Interview Tips',
  title_vi: 'Mẹo phỏng vấn xin việc',
  level: 'B1',
  category: 'career',
  content: `Preparing for a job interview can be stressful, but with the right approach you can feel confident and make a great impression. Here are some practical tips to help you succeed.

First, research the company before the interview. Visit their website, read recent news articles about them, and understand what they do. This shows the interviewer that you are genuinely interested in the position. You should also review the job description carefully and think about how your skills and experience match the requirements.

Second, prepare answers to common interview questions. For example, "Tell me about yourself," "What are your strengths and weaknesses?" and "Why do you want to work here?" Practice saying your answers out loud, but do not memorise them word for word — you want to sound natural, not robotic.

Third, plan what you are going to wear. Your clothes should be clean, neat, and appropriate for the company culture. When in doubt, it is better to dress slightly more formally than too casually.

On the day of the interview, arrive ten to fifteen minutes early. Bring extra copies of your CV, a notebook, and a pen. Greet everyone politely and make eye contact. During the interview, listen carefully to each question and take a moment to think before answering. At the end, ask one or two thoughtful questions about the role or the team.

Finally, send a short thank-you email within twenty-four hours. Mention something specific from the interview to show you were paying attention. Good luck!`,
  questions: [
    {
      question: 'What should you do before the interview?',
      options: [
        'Memorise answers word for word',
        'Research the company',
        'Buy new clothes',
        'Call the interviewer',
      ],
      answer: 'Research the company',
      explanation:
        'The text advises "research the company before the interview."',
    },
    {
      question:
        'How early should you arrive for the interview?',
      options: [
        '5 minutes',
        '10-15 minutes',
        '20-30 minutes',
        '1 hour',
      ],
      answer: '10-15 minutes',
      explanation:
        'The text says "arrive ten to fifteen minutes early."',
    },
    {
      question: 'What should you do after the interview?',
      options: [
        'Call the company immediately',
        'Send a thank-you email within 24 hours',
        'Visit the office again the next day',
        'Post about it on social media',
      ],
      answer: 'Send a thank-you email within 24 hours',
      explanation:
        'The text advises "send a short thank-you email within twenty-four hours."',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 8,
};
READING_JOB_INTERVIEW_TIPS.word_count = countWords(
  READING_JOB_INTERVIEW_TIPS.content,
);

const READING_AI_TUTORS: SeedContentItem = {
  type: 'reading',
  title: 'AI Tutors and Language Learning',
  title_vi: 'Gia sư AI và việc học ngôn ngữ',
  level: 'B2',
  category: 'technology',
  content: `Artificial intelligence has begun to transform the way people learn foreign languages. Traditionally, language learners relied on textbooks, classroom instruction, and immersion programmes. While these methods remain valuable, AI-powered tools are providing new opportunities for personalised and accessible learning.

One of the most significant advantages of AI tutors is their availability. Unlike human tutors, an AI chatbot can be accessed at any time of day, from virtually any location with an internet connection. This is particularly beneficial for learners with irregular schedules or those living in areas where qualified language teachers are scarce. The AI does not judge mistakes, which can reduce the anxiety many learners feel when practising a new language.

Modern AI language tools use large language models that have been trained on vast amounts of text. These models can generate natural-sounding conversations, correct grammatical errors, and even adapt their language level to match the learner's proficiency. Some platforms incorporate spaced repetition algorithms alongside AI conversation practice, creating a comprehensive learning ecosystem.

However, AI tutors have limitations. They may occasionally produce inaccurate translations or unnatural phrases. They lack genuine cultural understanding and cannot replicate the spontaneous, emotionally rich interactions that occur between humans. Furthermore, the quality of AI-generated feedback depends heavily on the model's training data, which may contain biases.

Experts suggest that the most effective approach is a blended one: using AI tools for daily practice and vocabulary reinforcement while still engaging with human speakers for cultural context and authentic communication. As the technology continues to evolve, the boundary between AI-assisted and traditional learning is likely to become increasingly blurred.`,
  questions: [
    {
      question: 'What is a key advantage of AI tutors over human tutors?',
      options: [
        'They are more culturally aware',
        'They are available 24/7',
        'They are always more accurate',
        'They replace the need for textbooks',
      ],
      answer: 'They are available 24/7',
      explanation:
        'The text states "an AI chatbot can be accessed at any time of day."',
    },
    {
      question: 'What limitation of AI tutors does the text mention?',
      options: [
        'They are too expensive',
        'They only work offline',
        'They may produce inaccurate translations',
        'They cannot handle beginner learners',
      ],
      answer: 'They may produce inaccurate translations',
      explanation:
        'The text says "They may occasionally produce inaccurate translations or unnatural phrases."',
    },
    {
      question: 'What approach do experts recommend?',
      options: [
        'Only using AI tools',
        'Only using human tutors',
        'A blended approach combining both',
        'Avoiding technology entirely',
      ],
      answer: 'A blended approach combining both',
      explanation:
        'The text says "the most effective approach is a blended one."',
    },
    {
      question: 'What technology underlies modern AI language tools?',
      options: [
        'Simple rule-based grammar checkers',
        'Large language models trained on vast text',
        'Pre-recorded audio dialogues',
        'Machine translation dictionaries',
      ],
      answer: 'Large language models trained on vast text',
      explanation:
        'The text mentions "large language models that have been trained on vast amounts of text."',
    },
  ],
  duration: '12 min',
  word_count: 0,
  sort_order: 9,
};
READING_AI_TUTORS.word_count = countWords(READING_AI_TUTORS.content);

const READING_CLIMATE_CHANGE: SeedContentItem = {
  type: 'reading',
  title: 'Climate Change and Our Responsibility',
  title_vi: 'Biến đổi khí hậu và trách nhiệm của chúng ta',
  level: 'B2',
  category: 'environment',
  content: `Climate change is one of the most pressing challenges of our time. Scientific consensus indicates that human activities, particularly the burning of fossil fuels, have significantly increased the concentration of greenhouse gases in the atmosphere. This has led to a rise in global average temperatures, more frequent extreme weather events, and the accelerating loss of polar ice.

The consequences of inaction are severe. Rising sea levels threaten coastal communities around the world. Agricultural patterns are shifting, making food production less predictable in many regions. Biodiversity is declining as habitats change faster than species can adapt. The World Health Organisation has described climate change as the greatest threat to global health in the twenty-first century.

Governments have responded with international agreements such as the Paris Agreement, which aims to limit global warming to 1.5 degrees Celsius above pre-industrial levels. Many countries have set ambitious targets to achieve net-zero carbon emissions by 2050. These commitments have driven investment in renewable energy sources, including solar, wind, and hydroelectric power.

However, government action alone is insufficient. Individuals and businesses also play a crucial role. Simple changes — such as reducing energy consumption, using public transport, eating less meat, and supporting sustainable brands — can collectively make a significant impact. Education is equally important: understanding the science behind climate change empowers people to make informed decisions and hold leaders accountable.

The challenge is enormous, but so is the opportunity. A transition to a sustainable economy can create new jobs, improve public health, and enhance quality of life. The choices we make today will determine the world that future generations inherit.`,
  questions: [
    {
      question:
        'What has primarily caused the increase in greenhouse gases?',
      options: [
        'Volcanic eruptions',
        'Burning of fossil fuels',
        'Deforestation only',
        'Natural climate cycles',
      ],
      answer: 'Burning of fossil fuels',
      explanation:
        'The text says "human activities, particularly the burning of fossil fuels."',
    },
    {
      question: 'What target does the Paris Agreement set?',
      options: [
        'Zero pollution by 2030',
        'Limit warming to 1.5°C above pre-industrial levels',
        'Ban all fossil fuels by 2040',
        'Reduce population growth',
      ],
      answer: 'Limit warming to 1.5°C above pre-industrial levels',
      explanation:
        'The text says the Paris Agreement "aims to limit global warming to 1.5 degrees Celsius above pre-industrial levels."',
    },
    {
      question: 'Which individual action is NOT mentioned in the text?',
      options: [
        'Reducing energy consumption',
        'Using public transport',
        'Planting trees',
        'Eating less meat',
      ],
      answer: 'Planting trees',
      explanation:
        'The text lists reducing energy consumption, using public transport, eating less meat, and supporting sustainable brands, but does not mention planting trees.',
    },
    {
      question:
        'What opportunity does the text associate with addressing climate change?',
      options: [
        'Increasing fossil fuel production',
        'Creating new jobs and improving public health',
        'Reducing international cooperation',
        'Slowing technological progress',
      ],
      answer: 'Creating new jobs and improving public health',
      explanation:
        'The final paragraph states "A transition to a sustainable economy can create new jobs, improve public health."',
    },
  ],
  duration: '12 min',
  word_count: 0,
  sort_order: 10,
};
READING_CLIMATE_CHANGE.word_count = countWords(READING_CLIMATE_CHANGE.content);

// ── Grammar Lessons ────────────────────────────────────────────────────────

const GRAMMAR_ARTICLES: SeedContentItem = {
  type: 'grammar',
  title: 'Articles: a, an, the',
  title_vi: 'Mạo từ: a, an, the',
  level: 'A1',
  category: 'articles',
  content: `Articles are small words that come before nouns. English has three articles: "a," "an," and "the."

Use "a" before a word that starts with a consonant sound:
• a book, a cat, a university (starts with a "yoo" sound)

Use "an" before a word that starts with a vowel sound:
• an apple, an egg, an hour (the "h" is silent)

"A" and "an" are indefinite articles. We use them when we talk about something for the first time or when it is not specific:
• I saw a dog in the park. (We don't know which dog.)
• She is an engineer. (One of many engineers.)

"The" is the definite article. We use it when the listener knows which thing we mean:
• I saw a dog in the park. The dog was very friendly. (Now we know which dog.)
• The sun rises in the east. (There is only one sun.)

We do NOT use articles before:
• Names of people: Maria, John
• Most country names: Japan, France (but: the United States, the United Kingdom)
• Meals: I had lunch at noon.`,
  data: {
    grammar_point: 'articles',
    key_rules: [
      'a + consonant sound',
      'an + vowel sound',
      'the = specific / known',
    ],
  },
  questions: [
    {
      question: 'Which article goes before "umbrella"?',
      options: ['a', 'an', 'the', 'no article'],
      answer: 'an',
      explanation:
        '"Umbrella" starts with a vowel sound (/ʌ/), so we use "an."',
    },
    {
      question: 'Choose the correct sentence.',
      options: [
        'She is a honest person.',
        'She is an honest person.',
        'She is the honest person.',
        'She is honest person.',
      ],
      answer: 'She is an honest person.',
      explanation:
        'The "h" in "honest" is silent, so the word starts with a vowel sound. We use "an."',
    },
    {
      question: 'Fill in the blank: I need to go to ___ bank.',
      options: ['a', 'an', 'the', 'no article'],
      answer: 'the',
      explanation:
        'We use "the" when both the speaker and listener know which specific bank is meant.',
    },
  ],
  duration: '8 min',
  word_count: 0,
  sort_order: 11,
};
GRAMMAR_ARTICLES.word_count = countWords(GRAMMAR_ARTICLES.content);

const GRAMMAR_PRESENT_SIMPLE_VS_CONTINUOUS: SeedContentItem = {
  type: 'grammar',
  title: 'Present Simple vs Present Continuous',
  title_vi: 'Thì hiện tại đơn và hiện tại tiếp diễn',
  level: 'A2',
  category: 'verb_tenses',
  content: `The Present Simple and Present Continuous are two of the most common tenses in English. They look similar but are used in different situations.

PRESENT SIMPLE — for habits, routines, and facts:
• I drink coffee every morning. (habit)
• She works at a hospital. (routine)
• Water boils at 100°C. (fact)
Form: Subject + base verb (add -s/-es for he/she/it)

PRESENT CONTINUOUS — for actions happening right now or temporary situations:
• I am drinking coffee right now. (happening now)
• She is working from home this week. (temporary)
• Look! It is raining. (at this moment)
Form: Subject + am/is/are + verb-ing

KEY DIFFERENCES:
• "I play tennis." = I play tennis regularly, as a hobby.
• "I am playing tennis." = I am playing tennis at this moment.

STATIVE VERBS — some verbs are almost never used in the continuous form:
• know, like, love, want, need, believe, understand, belong
• WRONG: I am knowing the answer.
• CORRECT: I know the answer.`,
  data: {
    grammar_point: 'present_simple_vs_continuous',
    key_rules: [
      'Simple = habits, routines, facts',
      'Continuous = now, temporary',
      'Stative verbs use Simple only',
    ],
  },
  questions: [
    {
      question: 'Choose the correct sentence: "She ___ to the gym every Tuesday."',
      options: ['goes', 'is going', 'going', 'go'],
      answer: 'goes',
      explanation:
        '"Every Tuesday" indicates a routine, so we use the Present Simple. Third person "she" takes "goes."',
    },
    {
      question: 'Choose the correct sentence: "Be quiet! The baby ___."',
      options: ['sleeps', 'is sleeping', 'sleep', 'sleeping'],
      answer: 'is sleeping',
      explanation:
        'The situation is happening right now, so we use the Present Continuous.',
    },
    {
      question: 'Which sentence is INCORRECT?',
      options: [
        'I am understanding the lesson.',
        'I understand the lesson.',
        'She is reading a book now.',
        'They play football on Saturdays.',
      ],
      answer: 'I am understanding the lesson.',
      explanation:
        '"Understand" is a stative verb and should not be used in the continuous form.',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 12,
};
GRAMMAR_PRESENT_SIMPLE_VS_CONTINUOUS.word_count = countWords(
  GRAMMAR_PRESENT_SIMPLE_VS_CONTINUOUS.content,
);

const GRAMMAR_PAST_SIMPLE: SeedContentItem = {
  type: 'grammar',
  title: 'Past Simple Tense',
  title_vi: 'Thì quá khứ đơn',
  level: 'A2',
  category: 'verb_tenses',
  content: `The Past Simple tense is used to talk about completed actions in the past.

REGULAR VERBS — add -ed to the base form:
• walk → walked: I walked to school yesterday.
• play → played: We played football last weekend.
• study → studied: She studied for three hours. (y → ied)
• stop → stopped: The bus stopped suddenly. (double consonant)

IRREGULAR VERBS — have special past forms (you must memorise them):
• go → went: I went to the cinema last night.
• eat → ate: He ate sushi for dinner.
• see → saw: We saw a beautiful sunset.
• have → had: They had a great time at the party.

NEGATIVE — use did not (didn't) + base verb:
• I didn't go to work yesterday.
• She didn't eat breakfast this morning.

QUESTIONS — use Did + subject + base verb:
• Did you see the movie? — Yes, I did. / No, I didn't.
• Did she call you? — Yes, she did.

TIME EXPRESSIONS often used with Past Simple:
yesterday, last week/month/year, ago, in 2020, when I was young`,
  data: {
    grammar_point: 'past_simple',
    key_rules: [
      'Regular: verb + -ed',
      'Irregular: memorise forms',
      'Negative: didn\'t + base verb',
      'Questions: Did + subject + base verb',
    ],
  },
  questions: [
    {
      question: 'What is the past simple form of "go"?',
      options: ['goed', 'went', 'gone', 'going'],
      answer: 'went',
      explanation: '"Go" is an irregular verb. Its past simple form is "went."',
    },
    {
      question: 'Choose the correct sentence.',
      options: [
        'She didn\'t went to school.',
        'She didn\'t go to school.',
        'She don\'t go to school.',
        'She not go to school.',
      ],
      answer: 'She didn\'t go to school.',
      explanation:
        'In Past Simple negatives, we use "didn\'t" + base verb (not the past form).',
    },
    {
      question: 'Fill in the blank: "They ___ (arrive) at the airport two hours ago."',
      options: ['arrive', 'arrived', 'arriving', 'arrives'],
      answer: 'arrived',
      explanation:
        '"Two hours ago" indicates Past Simple. "Arrive" is regular, so we add -d: "arrived."',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 13,
};
GRAMMAR_PAST_SIMPLE.word_count = countWords(GRAMMAR_PAST_SIMPLE.content);

const GRAMMAR_CONDITIONALS: SeedContentItem = {
  type: 'grammar',
  title: 'Conditionals (If Clauses)',
  title_vi: 'Câu điều kiện (Mệnh đề If)',
  level: 'B1',
  category: 'conditionals',
  content: `Conditionals are sentences with "if" that describe possible or imaginary situations and their results.

ZERO CONDITIONAL — for general truths and facts:
Form: If + present simple, present simple
• If you heat water to 100°C, it boils.
• If it rains, the ground gets wet.

FIRST CONDITIONAL — for real/possible future situations:
Form: If + present simple, will + base verb
• If it rains tomorrow, I will stay at home.
• If you study hard, you will pass the exam.
• If she doesn't hurry, she will miss the bus.

SECOND CONDITIONAL — for unreal/imaginary present or future situations:
Form: If + past simple, would + base verb
• If I had a million dollars, I would travel the world.
• If she spoke French, she would apply for that job.
• If I were you, I would accept the offer. (We often use "were" for all subjects.)

THIRD CONDITIONAL — for unreal past situations (things that did NOT happen):
Form: If + past perfect, would have + past participle
• If I had studied harder, I would have passed the exam.
• If they had left earlier, they would have caught the train.

IMPORTANT NOTES:
• The "if" clause can come first or second: "I will help you if you ask me."
• Never use "will" in the if-clause of the first conditional: If it will rain ✗ → If it rains ✓`,
  data: {
    grammar_point: 'conditionals',
    key_rules: [
      'Zero: If + present, present (facts)',
      'First: If + present, will + verb (real future)',
      'Second: If + past, would + verb (imaginary)',
      'Third: If + past perfect, would have + pp (unreal past)',
    ],
  },
  questions: [
    {
      question: 'Identify the conditional type: "If I were rich, I would buy a yacht."',
      options: ['Zero', 'First', 'Second', 'Third'],
      answer: 'Second',
      explanation:
        'The structure "If + past simple, would + verb" indicates the second conditional (imaginary situation).',
    },
    {
      question: 'Choose the correct first conditional sentence.',
      options: [
        'If it will rain, I stay home.',
        'If it rains, I will stay home.',
        'If it rained, I will stay home.',
        'If it rains, I would stay home.',
      ],
      answer: 'If it rains, I will stay home.',
      explanation:
        'First conditional uses "If + present simple, will + base verb."',
    },
    {
      question:
        'Fill in the blank: "If she ___ (leave) earlier, she would have caught the flight."',
      options: ['left', 'had left', 'has left', 'would leave'],
      answer: 'had left',
      explanation:
        'This is a third conditional (unreal past), so the if-clause uses the past perfect: "had left."',
    },
    {
      question: 'Which sentence is a zero conditional?',
      options: [
        'If you press this button, the machine starts.',
        'If you press this button, the machine will start.',
        'If you pressed this button, the machine would start.',
        'If you had pressed this button, the machine would have started.',
      ],
      answer: 'If you press this button, the machine starts.',
      explanation:
        'Zero conditional uses "If + present simple, present simple" for general truths or instructions.',
    },
  ],
  duration: '12 min',
  word_count: 0,
  sort_order: 14,
};
GRAMMAR_CONDITIONALS.word_count = countWords(GRAMMAR_CONDITIONALS.content);

const GRAMMAR_PASSIVE_VOICE: SeedContentItem = {
  type: 'grammar',
  title: 'Passive Voice',
  title_vi: 'Câu bị động',
  level: 'B1',
  category: 'voice',
  content: `The passive voice is used when the focus is on the action or the object, rather than who performs the action.

ACTIVE: The chef cooked the meal. (focus on the chef)
PASSIVE: The meal was cooked by the chef. (focus on the meal)

FORM: Subject + be (conjugated) + past participle (+ by agent)

TENSE EXAMPLES:
• Present Simple: "English is spoken in many countries."
• Past Simple: "The book was written in 1984."
• Present Perfect: "The letter has been sent."
• Future (will): "The project will be finished next week."
• Modal: "This report must be submitted by Friday."

WHEN TO USE THE PASSIVE:
1. The doer is unknown: "My bicycle was stolen." (We don't know who.)
2. The doer is obvious: "The criminal was arrested." (By the police — obvious.)
3. The action is more important than the doer: "The bridge was built in 1920."
4. In formal or scientific writing: "The experiment was conducted over six months."

WHEN NOT TO USE THE PASSIVE:
• Avoid it when the active voice is clearer and more direct.
• Active: "The dog bit the man." ✓ (clear)
• Passive: "The man was bitten by the dog." (less direct but grammatically fine)

BY-AGENT:
We include "by + agent" only when it adds important information.
• "The Mona Lisa was painted by Leonardo da Vinci." (important who)
• "The window was broken." (we don't know or care who)`,
  data: {
    grammar_point: 'passive_voice',
    key_rules: [
      'Form: be + past participle',
      'Use when doer is unknown or unimportant',
      'Include "by" agent only if important',
    ],
  },
  questions: [
    {
      question: 'Convert to passive: "Someone stole my wallet."',
      options: [
        'My wallet is stolen.',
        'My wallet was stolen.',
        'My wallet has stolen.',
        'My wallet were stolen.',
      ],
      answer: 'My wallet was stolen.',
      explanation:
        'The original is past simple, so the passive uses "was + past participle." The agent is unknown, so no "by" phrase is needed.',
    },
    {
      question: 'Which sentence is in the passive voice?',
      options: [
        'The students finished the test.',
        'The test was finished by the students.',
        'The students are finishing the test.',
        'The students have finished the test.',
      ],
      answer: 'The test was finished by the students.',
      explanation:
        'The passive structure is "be + past participle": "was finished."',
    },
    {
      question:
        'Choose the correct passive form: "This email ___ (must / send) today."',
      options: [
        'must sends',
        'must be sent',
        'must be sending',
        'must sent',
      ],
      answer: 'must be sent',
      explanation: 'Modal passives use "modal + be + past participle."',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 15,
};
GRAMMAR_PASSIVE_VOICE.word_count = countWords(GRAMMAR_PASSIVE_VOICE.content);

const GRAMMAR_REPORTED_SPEECH: SeedContentItem = {
  type: 'grammar',
  title: 'Reported Speech',
  title_vi: 'Câu tường thuật',
  level: 'B2',
  category: 'reported_speech',
  content: `Reported speech (also called indirect speech) is used to tell someone what another person said without using their exact words.

DIRECT SPEECH: He said, "I am tired."
REPORTED SPEECH: He said that he was tired.

TENSE CHANGES (backshift):
When the reporting verb is in the past (said, told, asked), the tenses usually shift back:
• Present Simple → Past Simple: "I like coffee." → She said she liked coffee.
• Present Continuous → Past Continuous: "I am working." → He said he was working.
• Past Simple → Past Perfect: "I went home." → She said she had gone home.
• Will → Would: "I will call you." → He said he would call me.
• Can → Could: "I can swim." → She said she could swim.

NO BACKSHIFT needed when:
• The information is still true: He said the Earth revolves around the Sun.
• The reporting verb is in present tense: She says she is coming.

PRONOUN AND TIME CHANGES:
• I → he/she; we → they; my → his/her
• today → that day; tomorrow → the next day; yesterday → the day before
• here → there; this → that; now → then

REPORTED QUESTIONS:
• Yes/No questions: She asked if/whether I was coming.
• Wh- questions: He asked where I lived. (Normal word order, no question mark.)

REPORTED COMMANDS AND REQUESTS:
• "Close the door." → She told me to close the door.
• "Please help me." → He asked me to help him.
• "Don't touch that." → She told me not to touch that.`,
  data: {
    grammar_point: 'reported_speech',
    key_rules: [
      'Backshift tenses when reporting verb is past',
      'Change pronouns and time references',
      'Questions: if/whether or wh- + normal word order',
      'Commands: told + object + to-infinitive',
    ],
  },
  questions: [
    {
      question:
        'Convert to reported speech: She said, "I will help you tomorrow."',
      options: [
        'She said she will help me tomorrow.',
        'She said she would help me the next day.',
        'She said she would help you tomorrow.',
        'She said she helped me the day before.',
      ],
      answer: 'She said she would help me the next day.',
      explanation:
        '"Will" shifts to "would," "you" changes to "me," and "tomorrow" changes to "the next day."',
    },
    {
      question:
        'Convert to reported speech: He asked, "Where do you live?"',
      options: [
        'He asked where do I live.',
        'He asked where I lived.',
        'He asked where did I live.',
        'He asked where I live.',
      ],
      answer: 'He asked where I lived.',
      explanation:
        'Reported wh-questions use normal word order (no inversion) and backshift the tense.',
    },
    {
      question:
        'Convert to reported speech: The teacher said, "Don\'t run in the hallway."',
      options: [
        'The teacher said don\'t run in the hallway.',
        'The teacher told us to not run in the hallway.',
        'The teacher told us not to run in the hallway.',
        'The teacher said that we didn\'t run in the hallway.',
      ],
      answer: 'The teacher told us not to run in the hallway.',
      explanation:
        'Negative commands in reported speech use "told + object + not + to-infinitive."',
    },
  ],
  duration: '12 min',
  word_count: 0,
  sort_order: 16,
};
GRAMMAR_REPORTED_SPEECH.word_count = countWords(
  GRAMMAR_REPORTED_SPEECH.content,
);

const GRAMMAR_RELATIVE_CLAUSES: SeedContentItem = {
  type: 'grammar',
  title: 'Relative Clauses',
  title_vi: 'Mệnh đề quan hệ',
  level: 'B2',
  category: 'clauses',
  content: `Relative clauses give extra information about a noun. They begin with a relative pronoun: who, which, that, whose, where, or when.

DEFINING RELATIVE CLAUSES — essential information (no commas):
• The woman who lives next door is a doctor. (Which woman? The one who lives next door.)
• The book that I borrowed was excellent. (Which book? The one I borrowed.)
• That's the restaurant where we had dinner.

"That" can replace "who" or "which" in defining clauses:
• The man that called you is my uncle. = The man who called you is my uncle.

NON-DEFINING RELATIVE CLAUSES — extra, non-essential information (with commas):
• My sister, who lives in Paris, is visiting next week. (I only have one sister.)
• The Eiffel Tower, which was built in 1889, is a famous landmark.
NOTE: "That" CANNOT be used in non-defining clauses.

OMITTING THE RELATIVE PRONOUN:
In defining clauses, the pronoun can be omitted when it is the object:
• The film (that/which) we watched was boring. ✓
But NOT when it is the subject:
• The man who called you is my uncle. ("who" cannot be omitted)

WHOSE — shows possession:
• The student whose essay won the prize is in my class.

WHERE / WHEN — for places and times:
• The café where we first met has closed down.
• 2020 was the year when everything changed.`,
  data: {
    grammar_point: 'relative_clauses',
    key_rules: [
      'Defining = essential info, no commas',
      'Non-defining = extra info, commas required',
      'Cannot use "that" in non-defining clauses',
      'Object pronouns can be omitted in defining clauses',
    ],
  },
  questions: [
    {
      question:
        'Which sentence contains a non-defining relative clause?',
      options: [
        'The car that he bought is red.',
        'My brother, who is a pilot, travels a lot.',
        'The students who passed will graduate.',
        'The restaurant where we ate was expensive.',
      ],
      answer: 'My brother, who is a pilot, travels a lot.',
      explanation:
        'Non-defining clauses are enclosed in commas and provide extra, non-essential information.',
    },
    {
      question:
        'Fill in the blank: "That is the professor ___ lectures are always interesting."',
      options: ['who', 'which', 'whose', 'that'],
      answer: 'whose',
      explanation:
        '"Whose" shows possession — the lectures belong to the professor.',
    },
    {
      question: 'In which sentence can the relative pronoun be omitted?',
      options: [
        'The woman who called you left a message.',
        'The cake which she baked was delicious.',
        'The city where I grew up is small.',
        'The boy whose father is a teacher won the race.',
      ],
      answer: 'The cake which she baked was delicious.',
      explanation:
        'In "which she baked," "which" is the object (she baked it). Object relative pronouns in defining clauses can be omitted.',
    },
  ],
  duration: '12 min',
  word_count: 0,
  sort_order: 17,
};
GRAMMAR_RELATIVE_CLAUSES.word_count = countWords(
  GRAMMAR_RELATIVE_CLAUSES.content,
);

// ── Listening Dialogues ────────────────────────────────────────────────────

const LISTENING_ORDERING_CAFE: SeedContentItem = {
  type: 'listening',
  title: 'Ordering at a Café',
  title_vi: 'Gọi đồ ở quán cà phê',
  level: 'A1',
  category: 'restaurant',
  content: `Waiter: Good morning! Welcome to Sunrise Café. What can I get for you?
Customer: Good morning. Can I have a cup of coffee, please?
Waiter: Of course. Would you like a large or a small?
Customer: A large, please.
Waiter: Would you like milk and sugar?
Customer: Just milk, no sugar, thank you.
Waiter: Anything else? We have fresh muffins today.
Customer: Oh, that sounds nice. I'll have a chocolate muffin, please.
Waiter: Sure. That's a large coffee with milk and one chocolate muffin. Anything else?
Customer: No, that's all. How much is it?
Waiter: That's four dollars and fifty cents.
Customer: Here you are. Thank you!
Waiter: Thank you. Enjoy your coffee!`,
  audio_url: '/audio/listening/a1-ordering-cafe.mp3',
  questions: [
    {
      question: 'What drink does the customer order?',
      options: ['Tea', 'Coffee', 'Juice', 'Hot chocolate'],
      answer: 'Coffee',
      explanation: 'The customer says "Can I have a cup of coffee, please?"',
    },
    {
      question: 'What size does the customer choose?',
      options: ['Small', 'Medium', 'Large', 'Extra large'],
      answer: 'Large',
      explanation: 'The customer says "A large, please."',
    },
    {
      question: 'How much does the order cost?',
      options: ['$3.50', '$4.00', '$4.50', '$5.00'],
      answer: '$4.50',
      explanation:
        'The waiter says "That\'s four dollars and fifty cents."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 18,
};
LISTENING_ORDERING_CAFE.word_count = countWords(
  LISTENING_ORDERING_CAFE.content,
);

const LISTENING_AT_THE_DOCTOR: SeedContentItem = {
  type: 'listening',
  title: 'At the Doctor',
  title_vi: 'Ở phòng khám bác sĩ',
  level: 'A1',
  category: 'health',
  content: `Doctor: Hello, please come in and sit down. What's the problem today?
Patient: Hello, doctor. I have a headache and a sore throat.
Doctor: I see. How long have you had these symptoms?
Patient: Since yesterday morning.
Doctor: Do you have a fever?
Patient: I think so. I feel very hot.
Doctor: Let me check your temperature. Hmm, yes, you have a slight fever — 37.8 degrees.
Patient: Is it serious?
Doctor: No, don't worry. It looks like a common cold. You need to rest and drink a lot of water.
Patient: Should I take any medicine?
Doctor: I'll prescribe some paracetamol for the headache and fever. Take one tablet every six hours.
Patient: Okay. Thank you, doctor.
Doctor: You're welcome. If you don't feel better in three days, come back and see me.
Patient: I will. Goodbye.
Doctor: Goodbye. Take care!`,
  audio_url: '/audio/listening/a1-at-the-doctor.mp3',
  questions: [
    {
      question: 'What symptoms does the patient have?',
      options: [
        'Headache and stomachache',
        'Headache and sore throat',
        'Cough and runny nose',
        'Back pain and fever',
      ],
      answer: 'Headache and sore throat',
      explanation:
        'The patient says "I have a headache and a sore throat."',
    },
    {
      question: 'What is the patient\'s temperature?',
      options: ['36.5°C', '37.0°C', '37.8°C', '38.5°C'],
      answer: '37.8°C',
      explanation: 'The doctor says "you have a slight fever — 37.8 degrees."',
    },
    {
      question: 'How often should the patient take the medicine?',
      options: [
        'Every 4 hours',
        'Every 6 hours',
        'Every 8 hours',
        'Twice a day',
      ],
      answer: 'Every 6 hours',
      explanation:
        'The doctor says "Take one tablet every six hours."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 19,
};
LISTENING_AT_THE_DOCTOR.word_count = countWords(
  LISTENING_AT_THE_DOCTOR.content,
);

const LISTENING_BOOKING_HOTEL: SeedContentItem = {
  type: 'listening',
  title: 'Booking a Hotel Room',
  title_vi: 'Đặt phòng khách sạn',
  level: 'A2',
  category: 'travel',
  content: `Receptionist: Good afternoon, Oceanview Hotel. How may I help you?
Guest: Hi, I'd like to book a room for two nights, please.
Receptionist: Certainly. When would you like to check in?
Guest: On Friday, March 15th.
Receptionist: And you'll be checking out on Sunday the 17th?
Guest: That's right.
Receptionist: Would you prefer a single room or a double room?
Guest: A double room, please. Does it have a sea view?
Receptionist: Yes, we have a double room with a sea view available. It's ninety-five dollars per night.
Guest: That sounds good. Does the price include breakfast?
Receptionist: Yes, breakfast is included. It's served in the restaurant from seven to ten AM.
Guest: Perfect. I'll take it.
Receptionist: Great. Can I have your name, please?
Guest: It's Anna Chen.
Receptionist: Thank you, Ms. Chen. Could I also have a credit card number to hold the reservation?
Guest: Sure, it's 4532-8810-2277-6643.
Receptionist: Thank you. Your reservation is confirmed. Is there anything else I can help with?
Guest: No, that's everything. Thank you very much.
Receptionist: You're welcome. We look forward to seeing you on Friday. Have a nice day!`,
  audio_url: '/audio/listening/a2-booking-hotel.mp3',
  questions: [
    {
      question: 'How many nights does the guest want to stay?',
      options: ['One', 'Two', 'Three', 'Four'],
      answer: 'Two',
      explanation: 'The guest says "I\'d like to book a room for two nights."',
    },
    {
      question: 'How much does the room cost per night?',
      options: ['$75', '$85', '$95', '$105'],
      answer: '$95',
      explanation:
        'The receptionist says "It\'s ninety-five dollars per night."',
    },
    {
      question: 'What time is breakfast served?',
      options: [
        '6:00-9:00 AM',
        '7:00-10:00 AM',
        '7:30-10:30 AM',
        '8:00-11:00 AM',
      ],
      answer: '7:00-10:00 AM',
      explanation:
        'The receptionist says breakfast is "served from seven to ten AM."',
    },
    {
      question: 'What type of room does the guest book?',
      options: [
        'Single with city view',
        'Single with sea view',
        'Double with city view',
        'Double with sea view',
      ],
      answer: 'Double with sea view',
      explanation:
        'The guest requests a double room, and the receptionist confirms a sea view is available.',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 20,
};
LISTENING_BOOKING_HOTEL.word_count = countWords(
  LISTENING_BOOKING_HOTEL.content,
);

const LISTENING_ASKING_DIRECTIONS: SeedContentItem = {
  type: 'listening',
  title: 'Asking for Directions',
  title_vi: 'Hỏi đường',
  level: 'A2',
  category: 'navigation',
  content: `Tourist: Excuse me, could you tell me how to get to the National Museum?
Local: Of course! It's not far from here. Go straight along this road for about two blocks.
Tourist: Okay, straight ahead for two blocks.
Local: Yes. Then turn left at the traffic lights. You'll see a big park on your right.
Tourist: Turn left at the traffic lights, park on the right. Got it.
Local: Walk past the park and continue for another block. The museum will be on your left. It's a large white building with columns at the entrance. You can't miss it.
Tourist: Great. How long does it take to walk there?
Local: About ten minutes.
Tourist: Is it open on Sundays?
Local: Yes, I believe it's open every day except Mondays. And I think entry is free on the first Sunday of each month.
Tourist: Oh, that's today! Wonderful. Thank you so much for your help.
Local: You're welcome. Enjoy the museum!`,
  audio_url: '/audio/listening/a2-asking-directions.mp3',
  questions: [
    {
      question: 'Where does the tourist want to go?',
      options: [
        'The train station',
        'The National Museum',
        'The park',
        'The city centre',
      ],
      answer: 'The National Museum',
      explanation:
        'The tourist asks "could you tell me how to get to the National Museum?"',
    },
    {
      question: 'What should the tourist do at the traffic lights?',
      options: [
        'Turn right',
        'Turn left',
        'Go straight',
        'Cross the road',
      ],
      answer: 'Turn left',
      explanation: 'The local says "turn left at the traffic lights."',
    },
    {
      question: 'How long is the walk to the museum?',
      options: ['5 minutes', '10 minutes', '15 minutes', '20 minutes'],
      answer: '10 minutes',
      explanation: 'The local says "About ten minutes."',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 21,
};
LISTENING_ASKING_DIRECTIONS.word_count = countWords(
  LISTENING_ASKING_DIRECTIONS.content,
);

const LISTENING_JOB_INTERVIEW: SeedContentItem = {
  type: 'listening',
  title: 'Job Interview',
  title_vi: 'Phỏng vấn xin việc',
  level: 'B1',
  category: 'career',
  content: `Interviewer: Good morning, please have a seat. Thank you for coming in today.
Candidate: Good morning. Thank you for inviting me.
Interviewer: So, I've reviewed your CV. Could you start by telling me a little about yourself?
Candidate: Of course. I graduated from university two years ago with a degree in marketing. Since then, I've been working as a marketing assistant at a small technology company. I've gained experience in social media management, content creation, and data analysis.
Interviewer: That's great. What attracted you to this position?
Candidate: Well, I've always admired your company's approach to sustainable business practices. I'd love the opportunity to work on larger campaigns and develop my skills in a more challenging environment.
Interviewer: Can you tell me about a time when you faced a difficult situation at work and how you handled it?
Candidate: Sure. Last year, we had a product launch with a very tight deadline. The designer fell ill a week before the launch. I stepped in and redesigned the campaign visuals myself using the skills I'd learned online. We launched on time and the campaign performed twenty percent better than expected.
Interviewer: Impressive. Where do you see yourself in five years?
Candidate: I'd like to be leading a marketing team, ideally in a company that values creativity and sustainability, like yours.
Interviewer: Excellent. Do you have any questions for us?
Candidate: Yes. Could you tell me more about the team I'd be working with?
Interviewer: Of course. The team has six members, and they're a very collaborative group. We'll be in touch within the next week with our decision.
Candidate: Wonderful. Thank you for your time.`,
  audio_url: '/audio/listening/b1-job-interview.mp3',
  questions: [
    {
      question: 'What did the candidate study at university?',
      options: ['Business', 'Marketing', 'Design', 'Computer Science'],
      answer: 'Marketing',
      explanation:
        'The candidate says "I graduated… with a degree in marketing."',
    },
    {
      question: 'How did the candidate handle the difficult situation?',
      options: [
        'Hired a freelancer',
        'Postponed the launch',
        'Redesigned the visuals themselves',
        'Asked the manager to help',
      ],
      answer: 'Redesigned the visuals themselves',
      explanation:
        'The candidate says "I stepped in and redesigned the campaign visuals myself."',
    },
    {
      question: 'How many people are on the team?',
      options: ['4', '5', '6', '8'],
      answer: '6',
      explanation: 'The interviewer says "The team has six members."',
    },
    {
      question:
        'What attracted the candidate to the company?',
      options: [
        'High salary',
        'Sustainable business practices',
        'Office location',
        'Remote work options',
      ],
      answer: 'Sustainable business practices',
      explanation:
        'The candidate says "I\'ve always admired your company\'s approach to sustainable business practices."',
    },
  ],
  duration: '10 min',
  word_count: 0,
  sort_order: 22,
};
LISTENING_JOB_INTERVIEW.word_count = countWords(
  LISTENING_JOB_INTERVIEW.content,
);

const LISTENING_MAKING_PLANS: SeedContentItem = {
  type: 'listening',
  title: 'Making Plans with Friends',
  title_vi: 'Lên kế hoạch với bạn bè',
  level: 'B1',
  category: 'social',
  content: `Sarah: Hey, are you doing anything this Saturday?
Mike: Not really. I was just planning to stay home and watch TV. Why?
Sarah: A group of us are thinking about going to that new escape room downtown. Have you heard of it?
Mike: Yeah, I've seen the ads. It's the one with the haunted house theme, right?
Sarah: That's the one! Apparently, it's really challenging. Only thirty percent of groups manage to escape within the time limit.
Mike: Sounds exciting. Who else is coming?
Sarah: So far it's me, Tom, and Lisa. We need at least four people to book a session, so you'd make the perfect fourth.
Mike: I'm in! What time are you thinking?
Sarah: The available slots are at two PM and four PM. I think two o'clock would be better because afterwards we could grab dinner somewhere.
Mike: Two works for me. Should we eat at that new Thai place on Park Street? I've heard really good things about it.
Sarah: Oh, great idea! I've been wanting to try that place for weeks. I'll make a reservation for six o'clock.
Mike: Perfect. How much is the escape room per person?
Sarah: It's twenty-five dollars each. You can pay online or at the door.
Mike: Cool, I'll pay online tonight. Thanks for organising this, Sarah.
Sarah: No problem! It's going to be a lot of fun. I'll send everyone the details in the group chat.
Mike: Awesome, see you Saturday!`,
  audio_url: '/audio/listening/b1-making-plans.mp3',
  questions: [
    {
      question: 'What activity are the friends planning?',
      options: [
        'Going to a concert',
        'Visiting an escape room',
        'Having a barbecue',
        'Going to the cinema',
      ],
      answer: 'Visiting an escape room',
      explanation:
        'Sarah says "A group of us are thinking about going to that new escape room."',
    },
    {
      question: 'What percentage of groups escape within the time limit?',
      options: ['20%', '30%', '40%', '50%'],
      answer: '30%',
      explanation:
        'Sarah says "Only thirty percent of groups manage to escape within the time limit."',
    },
    {
      question: 'What time slot do they choose?',
      options: ['12:00 PM', '2:00 PM', '4:00 PM', '6:00 PM'],
      answer: '2:00 PM',
      explanation: 'Sarah says "I think two o\'clock would be better."',
    },
    {
      question: 'How much does the escape room cost per person?',
      options: ['$15', '$20', '$25', '$30'],
      answer: '$25',
      explanation: 'Sarah says "It\'s twenty-five dollars each."',
    },
  ],
  duration: '8 min',
  word_count: 0,
  sort_order: 23,
};
LISTENING_MAKING_PLANS.word_count = countWords(LISTENING_MAKING_PLANS.content);

// ── New Japanese & Chinese Lessons ──────────────────────────────────────────

const READING_JAPANESE_FESTIVAL: SeedContentItem = {
  type: 'reading',
  title: 'Japanese Summer Festival',
  title_vi: 'Lễ hội mùa hè Nhật Bản (夏祭り)',
  level: 'N4',
  category: 'culture',
  content: `日本の夏祭りはとてもにぎやかです。毎年、七月から八月にかけて、多くの町や神社で祭りが行われます。人々は浴衣を着て、祭りに行きます。屋台では、たこ焼きや焼きそば、かき氷などが売られています。夜には大きな花火が打ち上がります。花火の音と光はとても美しく、祭りの一番の楽しみです。`,
  questions: [
    {
      question: 'What do people wear to the Japanese summer festival?',
      options: ['Kimono', 'Yukata', 'Suit', 'T-shirt'],
      answer: 'Yukata',
      explanation: 'The text says: 人々は浴衣を着て、祭りに行きます (People wear Yukata and go to the festival).',
    },
    {
      question: 'When are Japanese summer festivals usually held?',
      options: ['April to May', 'July to August', 'October to November', 'December to January'],
      answer: 'July to August',
      explanation: 'The text says: 毎年、七月から八月にかけて (Every year, from July to August).',
    },
    {
      question: 'What is considered the main highlight of the festival according to the text?',
      options: ['Food stalls', 'Shinto shrine visits', 'Fireworks at night', 'Traditional dances'],
      answer: 'Fireworks at night',
      explanation: 'The text says: 夜には大きな花火が打ち上がります。花火の音と光はとても美しく、祭りの一番の楽しみです。',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 24,
};
READING_JAPANESE_FESTIVAL.word_count = countWords(READING_JAPANESE_FESTIVAL.content);

const GRAMMAR_JAPANESE_TE_FORM: SeedContentItem = {
  type: 'grammar',
  title: 'Japanese Grammar: te-form (〜てください / 〜ています)',
  title_vi: 'Ngữ pháp tiếng Nhật: Thể て (te-form)',
  level: 'N4',
  category: 'verb-forms',
  content: `て形 (te-form) is one of the most important verb forms in Japanese. It is used to connect sentences, request actions, or describe ongoing states.

Formula:
- Group 1 (u-verbs):
  - -i, -chi, -ri -> -tte (e.g. 買う -> 買って)
  - -mi, -bi, -ni -> -nde (e.g. 飲む -> 飲んで)
  - -ki -> -ite, -gi -> -ide (e.g. 書く -> 書いて)
  - -shi -> -shite (e.g. 話す -> 話して)
- Group 2 (ru-verbs):
  - Drop -ru, add -te (e.g. 食べる -> 食べて)
- Group 3 (irregular):
  - する -> して, 来る -> きて

Common usages:
1. V-てください: Please do V (e.g. 書いてください - Please write).
2. V-ています: Am/Is/Are doing V (e.g. 食べています - I am eating).`,
  data: {
    grammar_point: 'te-form',
    key_rules: [
      'Group 1 conjugates to -tte, -nde, -ite, -ide, -shite',
      'Group 2 drops -ru and adds -te',
      'Group 3 is irregular: suru -> shite, kuru -> kite',
    ],
  },
  questions: [
    {
      question: 'What is the te-form of the verb 飲む (nomu - to drink)?',
      options: ['飲んで (nonde)', '飲みて (nomite)', '飲って (notte)', '飲みてく (nomiteku)'],
      answer: '飲んで (nonde)',
      explanation: '飲む ends in -mu, which belongs to Group 1 and conjugates to -nde.',
    },
    {
      question: 'Translate to Japanese: "Please read this book."',
      options: ['この本を読んでください。', 'この本を読みます。', 'この本を読んでいます。', 'この本を読みてください。'],
      answer: 'この本を読んでください。',
      explanation: 'V-てください is used for "please do". The te-form of 読む (yomu - to read) is 読んで.',
    },
    {
      question: 'Translate to Japanese: "I am eating breakfast now."',
      options: ['今朝ご飯を食べます。', '今朝ご飯を食べています。', '今朝ご飯を食べてください。', '今朝ご飯を食べました。'],
      answer: '今朝ご飯を食べています。',
      explanation: 'V-ています is used to describe an ongoing action.',
    },
  ],
  duration: '9 min',
  word_count: 0,
  sort_order: 25,
};
GRAMMAR_JAPANESE_TE_FORM.word_count = countWords(GRAMMAR_JAPANESE_TE_FORM.content);

const LISTENING_JAPANESE_DIRECTIONS: SeedContentItem = {
  type: 'listening',
  title: 'Asking for Directions in Tokyo',
  title_vi: 'Hỏi đường ở Tokyo (道を聞く)',
  level: 'N4',
  category: 'travel',
  content: `Ken: すみません、渋谷駅はどこですか？
Police: 渋谷駅ですか？ここをまっすぐ行って、二つ目の信号を右に曲がってください。
Ken: まっすぐ行って、二つ目の信号を右ですね。
Police: はい、そうです。右に曲がると、左側に大きなビルが見えます。駅はそのビルの隣です。
Ken: 分かりました。歩いてどのくらいですか？
Police: 五分くらいですよ。
Ken: どうもありがとうございました。`,
  audio_url: '/audio/listening/n4-japanese-directions.mp3',
  questions: [
    {
      question: 'What does Ken ask the police officer?',
      options: ['Where the toilet is', 'Where Shibuya station is', 'How much the ticket is', 'Where a restaurant is'],
      answer: 'Where Shibuya station is',
      explanation: 'Ken says: 渋谷駅はどこですか？ (Where is Shibuya station?)',
    },
    {
      question: 'What instruction does the police officer give first?',
      options: ['Turn left at the first light', 'Go straight and turn right at the second light', 'Go straight for ten minutes', 'Cross the street immediately'],
      answer: 'Go straight and turn right at the second light',
      explanation: 'The police officer says: ここをまっすぐ行って、二つ目の信号を右に曲がってください。',
    },
    {
      question: 'How long does it take to walk to the station?',
      options: ['About 5 minutes', 'About 10 minutes', 'About 15 minutes', 'About 2 minutes'],
      answer: 'About 5 minutes',
      explanation: 'The police officer says: 五分くらいですよ (It takes about 5 minutes).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 26,
};
LISTENING_JAPANESE_DIRECTIONS.word_count = countWords(LISTENING_JAPANESE_DIRECTIONS.content);

const READING_CHINESE_SPRING_FESTIVAL: SeedContentItem = {
  type: 'reading',
  title: 'Chinese Spring Festival',
  title_vi: 'Lễ hội mùa xuân Trung Quốc (春节)',
  level: 'HSK2',
  category: 'culture',
  content: `春节是中国最重要的传统节日。春节的时候, 大家都会回家和家人一起吃年夜饭。饺子是北方人必不可少的节日食品。人们还会贴红色的对联, 放鞭炮, 孩子们可以收到长辈给的压岁钱。大街上到处都是红色的灯笼, 非常喜庆。`,
  questions: [
    {
      question: 'What is the most important traditional festival in China?',
      options: ['Mid-Autumn Festival', 'Dragon Boat Festival', 'Spring Festival', 'Qingming Festival'],
      answer: 'Spring Festival',
      explanation: 'The text says: 春节是中国最重要的传统节日 (Spring Festival is the most important traditional festival in China).',
    },
    {
      question: 'What is the essential holiday food for people in the North?',
      options: ['Mooncakes', 'Rice dumplings', 'Dumplings (Jiaozi)', 'Noodles'],
      answer: 'Dumplings (Jiaozi)',
      explanation: 'The text says: 饺子是北方人必不可少的节日食品 (Jiaozi is the indispensable holiday food for northerners).',
    },
    {
      question: 'What do children receive from elders during Spring Festival?',
      options: ['Books', 'Red envelopes (lucky money)', 'New clothes', 'Toys'],
      answer: 'Red envelopes (lucky money)',
      explanation: 'The text mentions: 孩子们可以收到长辈给的压岁钱 (Children can receive lucky money from elders).',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 27,
};
READING_CHINESE_SPRING_FESTIVAL.word_count = countWords(READING_CHINESE_SPRING_FESTIVAL.content);

const GRAMMAR_CHINESE_LE: SeedContentItem = {
  type: 'grammar',
  title: 'Chinese Grammar: The Particle 了 (le)',
  title_vi: 'Ngữ pháp tiếng Trung: Trợ từ 了 (le)',
  level: 'HSK1',
  category: 'particles',
  content: `The particle 了 (le) is one of the most common and important particles in Mandarin Chinese. It has two main functions:

1. Completion of an Action (Aspect Particle):
Placing 了 directly after a verb indicates that the action is completed or realized:
- 我买了三本书。(I bought three books.)
- 他吃了午饭。(He ate lunch.)

2. Change of State (Modal Particle):
Placing 了 at the end of a sentence indicates a change of state, a new situation, or a realization:
- 下雨了。(It is raining now / it has started raining.)
- 我知道了。(I know now / I got it.)
- 他当爸爸了。(He has become a father.)`,
  data: {
    grammar_point: 'le-particle',
    key_rules: [
      'Verb + 了 = action completed',
      'Sentence + 了 = change of state or situation',
      'Negative sentences with 没 (méi) do not use 了',
    ],
  },
  questions: [
    {
      question: 'In the sentence "下雨了" (xià yǔ le), what does 了 indicate?',
      options: ['Action in the future', 'Change of state / new situation', 'Asking a question', 'Comparing two things'],
      answer: 'Change of state / new situation',
      explanation: 'Placing 了 at the end of "下雨了" indicates that the state has changed (it wasn\'t raining before, but it is now).',
    },
    {
      question: 'Which is the correct way to say "I bought a book"?',
      options: ['我买了书。', '我买书。', '我买书了买。', '我买没书。'],
      answer: '我买了书。',
      explanation: 'To indicate action completion, place 了 directly after the verb 买 (mǎi - to buy).',
    },
    {
      question: 'How do you say "I did not buy a book" in Chinese?',
      options: ['我没买书了。', '我没买书。', '我买书不。', '我不买书了。'],
      answer: '我没买书。',
      explanation: 'In negative sentences using 没 (méi), the aspect particle 了 is omitted.',
    },
  ],
  duration: '8 min',
  word_count: 0,
  sort_order: 28,
};
GRAMMAR_CHINESE_LE.word_count = countWords(GRAMMAR_CHINESE_LE.content);

const LISTENING_CHINESE_MEETING: SeedContentItem = {
  type: 'listening',
  title: 'Meeting a Friend in Beijing',
  title_vi: 'Gặp gỡ bạn bè ở Bắc Kinh (见面)',
  level: 'HSK2',
  category: 'conversation',
  content: `阿明：小丽，你好！好久不见！
小丽：阿明，你好！真高兴在北京见到你。你什么时候到的？
阿明：我昨天下午坐飞机到的。你最近怎么样？
小丽：我很忙，但是很好。我们中午一起去吃北京烤鸭吧！
阿明：太好了！我最喜欢吃烤鸭了。我们怎么去？
小丽：我们坐地铁去，很方便。
阿明：好的，没问题。`,
  audio_url: '/audio/listening/hsk2-chinese-meeting.mp3',
  questions: [
    {
      question: 'What is Xiaoli\'s reaction to seeing Amin?',
      options: ['She is angry', 'She is sad', 'She is very happy', 'She is surprised'],
      answer: 'She is very happy',
      explanation: 'Xiaoli says: 真高兴在北京见到你 (Really happy to see you in Beijing).',
    },
    {
      question: 'When did Amin arrive in Beijing?',
      options: ['This morning', 'Yesterday afternoon', 'Two days ago', 'Last week'],
      answer: 'Yesterday afternoon',
      explanation: 'Amin says: 我昨天下午坐飞机到的 (I arrived yesterday afternoon by plane).',
    },
    {
      question: 'How are they going to the restaurant?',
      options: ['By bus', 'By taxi', 'By subway', 'On foot'],
      answer: 'By subway',
      explanation: 'Xiaoli says: 我们坐地铁去，很方便 (We will take the subway, it is very convenient).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 29,
};
LISTENING_CHINESE_MEETING.word_count = countWords(LISTENING_CHINESE_MEETING.content);

// (Old duplicate export block removed)

// ── Additional New Lessons (Reading & Listening) ──────────────────────────

const READING_JAPANESE_TRAVEL: SeedContentItem = {
  type: 'reading',
  title: 'Traveling in Hokkaido',
  title_vi: 'Du lịch Hokkaido (北海道の旅行)',
  level: 'N4',
  category: 'travel',
  content: `北海道は日本の北にあります。冬は雪がたくさん降るので、スキーがとても有名です。毎年二月に札幌で「雪まつり」があります。大きな雪の彫刻がたくさん作られて、世界中から観光客が来ます。また、北海道は温泉も有名です。寒い冬に温かい温泉に入るのは最高です。カニやラーメンなどの美味しい食べ物もたくさんあります。`,
  questions: [
    {
      question: 'Where is Hokkaido located in Japan?',
      options: ['In the south', 'In the north', 'In the east', 'In the west'],
      answer: 'In the north',
      explanation: 'The text says: 北海道は日本の北にあります (Hokkaido is in the north of Japan).',
    },
    {
      question: 'Why is skiing famous in Hokkaido?',
      options: ['Because it is cheap', 'Because it snows a lot in winter', 'Because there are no mountains', 'Because it is always hot'],
      answer: 'Because it snows a lot in winter',
      explanation: 'The text says: 冬は雪がたくさん降るので、スキーがとても有名です (Because it snows a lot in winter, skiing is very famous).',
    },
    {
      question: 'What festival is held in Sapporo every February?',
      options: ['Cherry Blossom Festival', 'Summer Festival', 'Snow Festival', 'Autumn Leaves Festival'],
      answer: 'Snow Festival',
      explanation: 'The text mentions: 毎年二月に札幌で「雪まつり」があります (Every February in Sapporo, there is a "Snow Festival").',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 30,
};
READING_JAPANESE_TRAVEL.word_count = countWords(READING_JAPANESE_TRAVEL.content);

const READING_CHINESE_TEA: SeedContentItem = {
  type: 'reading',
  title: 'Chinese Tea Culture',
  title_vi: 'Văn hóa trà Trung Quốc (中国茶文化)',
  level: 'HSK3',
  category: 'culture',
  content: `茶是中国人日常生活中不可缺少的一部分。中国人喝茶的历史已经有几千年了。茶有很多种类，主要有绿茶、红茶、乌龙茶和花茶。喝茶不仅对身体健康有好处，比如能帮助消化、让人精神变好，而且喝茶也是一种社交方式。当有客人来家里时，主人总会先泡一杯热茶，表示欢迎。`,
  questions: [
    {
      question: 'How long is the history of Chinese tea drinking?',
      options: ['A few decades', 'A few centuries', 'Several thousand years', 'It just started recently'],
      answer: 'Several thousand years',
      explanation: 'The text says: 中国人喝茶的历史已经有几千年了 (The history of Chinese tea drinking has already been several thousand years).',
    },
    {
      question: 'Which of the following is NOT mentioned as a benefit of drinking tea?',
      options: ['Helping digestion', 'Making people feel energized', 'Making people sleep longer', 'Improving physical health'],
      answer: 'Making people sleep longer',
      explanation: 'The text mentions helping digestion (帮助消化) and making people feel energized (让人精神变好), but not sleeping longer.',
    },
    {
      question: 'What does a Chinese host usually do when guests arrive?',
      options: ['Make a cup of hot tea', 'Cook a big dinner', 'Give them lucky money', 'Play traditional music'],
      answer: 'Make a cup of hot tea',
      explanation: 'The text says: 主人总会先泡一杯热茶，表示欢迎 (The host will always first brew a cup of hot tea to show welcome).',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 31,
};
READING_CHINESE_TEA.word_count = countWords(READING_CHINESE_TEA.content);

const READING_ENGLISH_HEALTH: SeedContentItem = {
  type: 'reading',
  title: 'Benefits of the Mediterranean Diet',
  title_vi: 'Lợi ích của chế độ ăn Địa Trung Hải',
  level: 'B2',
  category: 'health',
  content: `The Mediterranean diet is inspired by the eating habits of people living in countries bordering the Mediterranean Sea, such as Greece, Italy, and Spain. Rather than a strict diet plan, it represents a lifestyle characterized by high consumption of olive oil, vegetables, fresh fruits, nuts, legumes, and whole grains. Moderate amounts of fish, poultry, and dairy are included, while red meat and processed foods are kept to a minimum. Numerous scientific studies suggest that adhering to this dietary pattern can significantly reduce the risk of cardiovascular diseases, promote brain health, and support healthy weight management. Olive oil, in particular, is rich in monounsaturated fatty acids, which play a key role in lower cholesterol levels and reducing inflammation. Furthermore, this diet emphasizes eating meals with family and friends, which contributes to emotional well-being and stress reduction.`,
  questions: [
    {
      question: 'Which country is NOT mentioned as an inspiration for the Mediterranean diet?',
      options: ['Greece', 'Italy', 'France', 'Spain'],
      answer: 'France',
      explanation: 'The text mentions Greece, Italy, and Spain, but not France.',
    },
    {
      question: 'What is the primary source of fat recommended in this diet?',
      options: ['Butter', 'Olive oil', 'Coconut oil', 'Red meat fat'],
      answer: 'Olive oil',
      explanation: 'The text emphasizes the high consumption of olive oil, which is rich in monounsaturated fatty acids.',
    },
    {
      question: 'What psychological/social benefit of the diet is mentioned?',
      options: [
        'It saves money on groceries',
        'It requires very little cooking time',
        'Eating meals with family and friends reduces stress',
        'It helps people learn new recipes'
      ],
      answer: 'Eating meals with family and friends reduces stress',
      explanation: 'The text says: "...emphasizes eating meals with family and friends, which contributes to emotional well-being and stress reduction."',
    },
  ],
  duration: '8 min',
  word_count: 0,
  sort_order: 32,
};
READING_ENGLISH_HEALTH.word_count = countWords(READING_ENGLISH_HEALTH.content);

const READING_KOREAN_KPOP: SeedContentItem = {
  type: 'reading',
  title: 'The Rise of Hallyu',
  title_vi: 'Sự trỗi dậy của làn sóng Hallyu (한류의 역사)',
  level: 'TOPIK2',
  category: 'culture',
  content: `한류는 한국의 대중문화가 해외에서 큰 인기를 얻는 현상을 말합니다. 1990년대 후반에 중국과 동남아시아에서 한국 드라마가 인기를 끌면서 시작되었습니다. 이후 2000년대부터는 K-팝이 아시아를 넘어 전 세계로 퍼져 나갔습니다. 오늘날에는 블랙핑크나 BTS와 같은 그룹들이 빌보드 차트에서 1위를 차지하며 글로벌 팬들의 사랑을 받고 있습니다. 한국 정부와 기업들도 한류 콘텐츠의 수출을 적극적으로 지원하고 있으며, 한류는 단순한 유행을 넘어 한국의 중요한 브랜드 이미지가 되었습니다.`,
  questions: [
    {
      question: 'When and where did Hallyu start getting popular?',
      options: ['Late 1990s in China and Southeast Asia', 'Early 2000s in America', '1980s in Japan', 'Late 2010s in Europe'],
      answer: 'Late 1990s in China and Southeast Asia',
      explanation: 'The text says: 1990년대 후반에 중국과 동남아시아에서 한국 드라마가 인기를 끌면서 시작되었습니다.',
    },
    {
      question: 'Which music groups are mentioned as examples of global K-pop success?',
      options: ['TVXQ and Super Junior', 'BTS and Blackpink', 'EXO and Twice', 'PSY and Girls\' Generation'],
      answer: 'BTS and Blackpink',
      explanation: 'The text explicitly mentions "블랙핑크나 BTS와 같은 그룹들" (Groups like Blackpink and BTS).',
    },
    {
      question: 'What is the current status of Hallyu according to the text?',
      options: [
        'It is a fading trend',
        'It is only popular in Korea',
        'It has become an important brand image for Korea',
        'It is only supported by foreign fans'
      ],
      answer: 'It has become an important brand image for Korea',
      explanation: 'The text states: 한류는 단순한 유행을 넘어 한국의 중요한 브랜드 이미지가 되었습니다 (Hallyu has gone beyond a simple trend to become an important brand image for Korea).',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 33,
};
READING_KOREAN_KPOP.word_count = countWords(READING_KOREAN_KPOP.content);

const LISTENING_JAPANESE_RESTAURANT: SeedContentItem = {
  type: 'listening',
  title: 'Ordering at a Restaurant',
  title_vi: 'Gọi món tại nhà hàng (レストランでの注文)',
  level: 'N4',
  category: 'daily_life',
  content: `店員：いらっしゃいませ。何名様ですか？
佐藤：二人です。禁煙席をお願いします。
店員：はい、こちらへどうぞ。メニューになります。ご注文が決まりましたらお呼びください。
（数分後）
佐藤：すみません、注文をお願いします。
店員：はい、お伺いいたします。
佐藤：天ぷら定食一つと、唐揚げ定食一つをお願いします。あと、冷たいお茶を二つください。
店員：かしこまりました。天ぷら定食とお茶が二つですね。少々お待ちください。`,
  questions: [
    {
      question: 'How many people are dining?',
      options: ['One person', 'Two people', 'Three people', 'Four people'],
      answer: 'Two people',
      explanation: 'Sato says: 二人です (Two people).',
    },
    {
      question: 'What kind of seats did Sato request?',
      options: ['Smoking seats', 'Non-smoking seats', 'Window seats', 'Private room'],
      answer: 'Non-smoking seats',
      explanation: 'Sato requested: 禁煙席をお願いします (Non-smoking seats please).',
    },
    {
      question: 'Which of the following dishes did Sato NOT order?',
      options: ['Tempura Set Meal', 'Karaage Set Meal', 'Sushi Set Meal', 'Cold green tea'],
      answer: 'Sushi Set Meal',
      explanation: 'Sato ordered Tempura set meal (天ぷら定食), Karaage set meal (唐揚げ定食), and cold tea (冷たいお茶), but not Sushi.',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 34,
};
LISTENING_JAPANESE_RESTAURANT.word_count = countWords(LISTENING_JAPANESE_RESTAURANT.content);

const LISTENING_CHINESE_WEATHER: SeedContentItem = {
  type: 'listening',
  title: 'Talking about Weather and Travel Plans',
  title_vi: 'Thảo luận thời tiết và kế hoạch du lịch (谈论天气)',
  level: 'HSK2',
  category: 'daily_life',
  content: `大卫：小明，明天北京的天气怎么样？
小明：听说说明天会下雨，而且有点儿冷，最高温度只有十五度。
大卫：啊？那我们还能去长城旅游吗？
小明：下雨天去长城不太安全，路很滑。我们下个周末再去吧。
大卫：好吧，那明天我们在家看电影，或者去博物馆怎么样？
小明：去博物馆是个好主意，我们坐地铁去。`,
  questions: [
    {
      question: 'What will the weather be like in Beijing tomorrow?',
      options: ['Sunny and hot', 'It will rain and be cold', 'Windy but warm', 'It will snow'],
      answer: 'It will rain and be cold',
      explanation: 'Xiaoming says: 听说说明天会下雨，而且有点儿冷 (I heard it will rain tomorrow, and it is a bit cold).',
    },
    {
      question: 'Why does Xiaoming suggest NOT going to the Great Wall tomorrow?',
      options: [
        'It is closed on rainy days',
        'It is too expensive',
        'It is unsafe because the road is slippery',
        'It is too far away'
      ],
      answer: 'It is unsafe because the road is slippery',
      explanation: 'Xiaoming explains: 下雨天去长城不太安全，路很滑 (Going to the Great Wall on a rainy day is not safe, the road is slippery).',
    },
    {
      question: 'What do they decide to do tomorrow instead?',
      options: ['Go to the cinema', 'Stay home and cook', 'Go to the museum by subway', 'Go shopping'],
      answer: 'Go to the museum by subway',
      explanation: 'They agree on going to the museum: 去博物馆是个好主意，我们坐地铁去 (Going to the museum is a good idea, we will take the subway).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 35,
};
LISTENING_CHINESE_WEATHER.word_count = countWords(LISTENING_CHINESE_WEATHER.content);

const LISTENING_ENGLISH_AIRPORT: SeedContentItem = {
  type: 'listening',
  title: 'Airport Inquiry',
  title_vi: 'Hỏi thông tin tại sân bay',
  level: 'B1',
  category: 'travel',
  content: `Passenger: Excuse me, could you help me? I am looking for the boarding gate for flight VN123 to Hanoi.
Information Desk: Let me check the screen for you. VN123 to Hanoi... Ah, yes. The flight is boarding at Gate 24 in Terminal 2.
Passenger: Gate 24, Terminal 2. Got it. How do I get to Terminal 2 from here?
Information Desk: You need to take the airport shuttle train. The train station is just down the escalator, on your left. It runs every 5 minutes and takes about 3 minutes to get there.
Passenger: Thank you. Do I have enough time? The departure is at 4:30 PM, and it is 3:45 PM now.
Information Desk: Yes, you have plenty of time. Boarding starts at 4:00 PM, so you should head there now.
Passenger: Great, thanks for your help!`,
  questions: [
    {
      question: 'Where is the passenger flying to?',
      options: ['Ho Chi Minh City', 'Hanoi', 'Tokyo', 'Singapore'],
      answer: 'Hanoi',
      explanation: 'The passenger says they are looking for the boarding gate for "flight VN123 to Hanoi".',
    },
    {
      question: 'How should the passenger travel to Terminal 2?',
      options: ['Walk across the bridge', 'Take a taxi', 'Take the airport shuttle train', 'Ride a bus'],
      answer: 'Take the airport shuttle train',
      explanation: 'The clerk says: "You need to take the airport shuttle train."',
    },
    {
      question: 'What time does the flight depart?',
      options: ['3:45 PM', '4:00 PM', '4:30 PM', '5:00 PM'],
      answer: '4:30 PM',
      explanation: 'The passenger mentions: "The departure is at 4:30 PM".',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 36,
};
LISTENING_ENGLISH_AIRPORT.word_count = countWords(LISTENING_ENGLISH_AIRPORT.content);

const LISTENING_KOREAN_INTRO: SeedContentItem = {
  type: 'listening',
  title: 'Meeting a New Classmate',
  title_vi: 'Gặp gỡ bạn học mới (새 친구)',
  level: 'TOPIK1',
  category: 'daily_life',
  content: `민수: 안녕하세요? 처음 뵙겠습니다. 저는 김민수입니다.
지호: 안녕하세요, 민수 씨. 저는 지호라고 합니다.
민수: 지호 씨는 학생입니까?
지호: 네, 저는 대학교에서 한국어를 전공하고 있습니다. 민수 씨는 무슨 일을 하십니까?
민수: 저는 회사원입니다. 컴퓨터 회사에서 일하고 있습니다.
지호: 아, 그렇군요! 취미가 무엇입니까?
민수: 제 취미는 영화 감상과 테니스입니다. 주말에 친구들과 테니스를 자주 쳐요.
지호: 저도 테니스를 좋아하는데요. 다음에 같이 칩시다!
민수: 좋습니다. 같이 쳐요.`,
  questions: [
    {
      question: 'What is Min-su\'s job?',
      options: ['University student', 'Korean teacher', 'Office worker at a computer company', 'Professional tennis player'],
      answer: 'Office worker at a computer company',
      explanation: 'Minsu says: 저는 회사원입니다. 컴퓨터 회사에서 일하고 있습니다 (I am an office worker. I work at a computer company).',
    },
    {
      question: 'What is Ji-ho\'s major at university?',
      options: ['Computer Science', 'Korean Language', 'Business Administration', 'Film Production'],
      answer: 'Korean Language',
      explanation: 'Ji-ho says: 대학교에서 한국어를 전공하고 있습니다 (I am majoring in Korean at university).',
    },
    {
      question: 'What hobby do they both share?',
      options: ['Watching movies', 'Playing tennis', 'Reading books', 'Cooking'],
      answer: 'Playing tennis',
      explanation: 'Minsu mentions tennis is his hobby, and Ji-ho responds: 저도 테니스를 좋아하는데요 (I also like tennis).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 37,
};
LISTENING_KOREAN_INTRO.word_count = countWords(LISTENING_KOREAN_INTRO.content);

// ── 12 New Reading & Listening Lessons ──────────────────────────────────────

const READING_ENGLISH_INTERNET: SeedContentItem = {
  type: 'reading',
  title: 'The History of the Internet',
  title_vi: 'Lịch sử Internet',
  level: 'B1',
  category: 'technology',
  content: `The internet has changed the way we live, work, and communicate. Its history began in the late 1960s with a project called ARPANET, funded by the United States Department of Defense. This network allowed scientists and researchers at different universities to share information and compute resources. In the 1980s, the technology grew as more academic institutions connected. The major breakthrough came in 1989 when Sir Tim Berners-Lee invented the World Wide Web. This made the internet user-friendly by introducing websites, hyperlinks, and web browsers. By the late 1990s, the internet became a global phenomenon, transforming business, entertainment, and personal communication. Today, billions of people around the world connect to the internet daily using smartphones, computers, and other smart devices.`,
  questions: [
    {
      question: 'When did the history of the internet begin?',
      options: ['Late 1950s', 'Late 1960s', 'Late 1970s', 'Late 1980s'],
      answer: 'Late 1960s',
      explanation: 'The text says: "Its history began in the late 1960s with a project called ARPANET..."',
    },
    {
      question: 'Who funded the ARPANET project?',
      options: ['Sir Tim Berners-Lee', 'A group of universities', 'The United States Department of Defense', 'Private technology companies'],
      answer: 'The United States Department of Defense',
      explanation: 'The text says: "...a project called ARPANET, funded by the United States Department of Defense."',
    },
    {
      question: 'What did Sir Tim Berners-Lee invent in 1989?',
      options: ['The computer', 'ARPANET', 'The email', 'The World Wide Web'],
      answer: 'The World Wide Web',
      explanation: 'The text says: "The major breakthrough came in 1989 when Sir Tim Berners-Lee invented the World Wide Web."',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 38,
};
READING_ENGLISH_INTERNET.word_count = countWords(READING_ENGLISH_INTERNET.content);

const READING_ENGLISH_TOURISM: SeedContentItem = {
  type: 'reading',
  title: 'Sustainable Tourism',
  title_vi: 'Du lịch bền vững',
  level: 'B2',
  category: 'travel',
  content: `Tourism is one of the world's largest industries, but it can have significant negative impacts on local environments and communities. Sustainable tourism aims to minimize these negative effects while maximizing the benefits for local residents and preserving the natural heritage. This practice involves making environmentally friendly choices, such as reducing water and energy consumption, avoiding single-use plastics, and supporting local businesses. Travelers are encouraged to respect local cultures, choose eco-friendly accommodations, and use public transportation or walk instead of renting private cars. By practicing sustainable tourism, we ensure that popular destinations remain beautiful and culturally rich for future generations. It is a shared responsibility between governments, the travel industry, and travelers themselves.`,
  questions: [
    {
      question: 'What is the primary goal of sustainable tourism?',
      options: [
        'To make travel cheaper for tourists',
        'To build more luxury hotels in popular cities',
        'To minimize negative impacts and preserve local heritage',
        'To replace public transport with private cars'
      ],
      answer: 'To minimize negative impacts and preserve local heritage',
      explanation: 'The text says: "Sustainable tourism aims to minimize these negative effects while maximizing the benefits for local residents and preserving the natural heritage."',
    },
    {
      question: 'Which of the following is NOT an environmentally friendly choice mentioned in the text?',
      options: [
        'Reducing water and energy consumption',
        'Renting private cars instead of using public transport',
        'Avoiding single-use plastics',
        'Supporting local businesses'
      ],
      answer: 'Renting private cars instead of using public transport',
      explanation: 'The text encourages travelers to "use public transportation or walk instead of renting private cars."',
    },
    {
      question: 'Who shares the responsibility for sustainable tourism?',
      options: [
        'Only the travelers',
        'Only the local residents',
        'Governments, the travel industry, and travelers',
        'Hotels and airlines only'
      ],
      answer: 'Governments, the travel industry, and travelers',
      explanation: 'The text states: "It is a shared responsibility between governments, the travel industry, and travelers themselves."',
    },
  ],
  duration: '7 min',
  word_count: 0,
  sort_order: 39,
};
READING_ENGLISH_TOURISM.word_count = countWords(READING_ENGLISH_TOURISM.content);

const READING_JAPANESE_GARDENS: SeedContentItem = {
  type: 'reading',
  title: 'Traditional Japanese Gardens',
  title_vi: 'Vườn truyền thống Nhật Bản (日本庭園)',
  level: 'N3',
  category: 'culture',
  content: `日本庭園（にほんていえん）は、自然の美しさを狭い場所に表現した伝統的な庭です。池や石、川、そして様々な植物を使って、山や海の景色を作り出します。日本庭園にはいくつかの種類がありますが、最も有名なものの一つが「枯山水（かれさんすい）」です。枯山水は水を使わず、白い砂と石だけで水や山を表現します。お寺などでよく見られ、見る人に静かな気持ちを与えます。庭園を散歩しながら、季節ごとに変わる花や木の美しさを楽しむことができます。日本庭園は、ただ見るだけでなく、自然と人間が調和する精神的な場所でもあります。`,
  questions: [
    {
      question: '日本庭園は何を使って景色を作り出しますか？',
      options: [
        'ガラスやプラスチック',
        '池や石、川、様々な植物',
        '絵画や彫刻だけ',
        '大きな建物とライト'
      ],
      answer: '池や石、川、様々な植物',
      explanation: 'The text says: "池や石、川、そして様々な植物を使って、山や海の景色を作り出します。"',
    },
    {
      question: '「枯山水（かれさんすい）」の特徴は何ですか？',
      options: [
        'たくさんの温かい水を使うこと',
        'カラフルな花をたくさん植えること',
        '水を使わず、白い砂と石だけで水や山を表現すること',
        '大きな池で魚を育てること'
      ],
      answer: '水を使わず、白い砂と石だけで水や山を表現すること',
      explanation: 'The text says: "枯山水は水を使わず、白い砂と石だけで水や山を表現します。"',
    },
    {
      question: '日本庭園はどのような場所だと言われていますか？',
      options: [
        'スポーツをするための広い場所',
        '買い物を楽しむにぎやかな場所',
        '自然と人間が調和する精神的な場所',
        '新しい科学技術をテストする場所'
      ],
      answer: '自然と人間が調和する精神的な場所',
      explanation: 'The text states: "日本庭園は、ただ見るだけでなく、自然と人間が調和する精神的な場所でもあります。"',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 40,
};
READING_JAPANESE_GARDENS.word_count = countWords(READING_JAPANESE_GARDENS.content);

const READING_JAPANESE_MANNERS: SeedContentItem = {
  type: 'reading',
  title: 'Working in Japan / Business Manners',
  title_vi: 'Văn hóa ứng xử trong kinh doanh tại Nhật Bản (日本のビジネスマナー)',
  level: 'N4',
  category: 'daily_life',
  content: `日本で働くとき、ビジネスマナーはとても重要です。まず、挨拶をするときは頭を下げて「お辞儀（おじぎ）」をします。お辞儀の角度は、相手や状況によって変わります。また、初めて会う人とは「名刺（めいし）」を交換します。名刺は両手で持ち、相手に文字が見えるように渡さなければなりません。そして、時間は絶対に守らなければなりません。会議の時間の５分前には準備を終わらせて待つのが基本です。日本の会社では、チームワークや他への配慮が大切にされています。これらのマナーを守ることで、仕事の人間関係が良くなります。`,
  questions: [
    {
      question: '挨拶をするときに何をしますか？',
      options: [
        '握手（あくしゅ）を強くする',
        '頭を下げてお辞儀をする',
        '笑顔で手を振る',
        '大声で歌を歌う'
      ],
      answer: '頭を下げてお辞儀をする',
      explanation: 'The text says: "まず、挨拶をするときは頭を下げて「お辞儀（おじぎ）」をします。"',
    },
    {
      question: '名刺（めいし）を渡すときの正しいマナーは何ですか？',
      options: [
        '片手で素早く投げる',
        'ポケットから出してそのまま置く',
        '両手で持ち、相手に文字が見えるように渡す',
        '自分の名前を隠して渡す'
      ],
      answer: '両手で持ち、相手に文字が見えるように渡す',
      explanation: 'The text says: "名刺は両手で持ち、相手に文字が見えるように渡さなければなりません。"',
    },
    {
      question: '会議が始まるとき、いつ準備を終わらせるべきですか？',
      options: [
        '会議が始まった後１０分後',
        '会議の時間の５分前',
        '会議のちょうど同じ時間',
        'いつでも自由で良い'
      ],
      answer: '会議の時間の５分前',
      explanation: 'The text says: "会議の時間の５分前には準備を終わらせて待つのが基本です。"',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 41,
};
READING_JAPANESE_MANNERS.word_count = countWords(READING_JAPANESE_MANNERS.content);

const READING_CHINESE_MIDAUTUMN: SeedContentItem = {
  type: 'reading',
  title: 'The Mid-Autumn Festival',
  title_vi: 'Tết Trung Thu (中秋节)',
  level: 'HSK2',
  category: 'culture',
  content: `中秋节是中国非常重要的传统节日，在农历八月十五这一天。这一天的月亮特别圆、特别亮，代表着团圆。在这一天，家人会坐在一起吃晚饭，赏月，吃月饼。月饼是一种好吃的甜点，里面常常有豆沙、蛋黄等。因为月亮代表家乡和亲人，所以很多不能回家的人，会在这一天看着月亮，想念远方的家人。现在，中秋节也是一个放假的节日，大家可以回家看望父母，或者和朋友一起出去旅游。`,
  questions: [
    {
      question: '中秋节是在什么时候？',
      options: ['农历正月初一', '农历五月初五', '农历八月十五', '农历九月九日'],
      answer: '农历八月十五',
      explanation: 'The text says: "中秋节是中国非常重要的传统节日，在农历八月十五这一天。"',
    },
    {
      question: '月亮在这一天特别圆特别亮，代表什么？',
      options: ['发财', '健康', '工作', '团圆'],
      answer: '团圆',
      explanation: 'The text says: "这一天的月亮特别圆、特别亮，代表着团圆。"',
    },
    {
      question: '不能回家的人在中秋节会做什么？',
      options: [
        '给家里打电话要钱',
        '看着月亮，想念远方的家人',
        '在公司继续加班工作',
        '买很多贵重的礼物送给自己'
      ],
      answer: '看着月亮，想念远方的家人',
      explanation: 'The text says: "很多不能回家的人，会在这一天看着月亮，想念远方的家人。"',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 42,
};
READING_CHINESE_MIDAUTUMN.word_count = countWords(READING_CHINESE_MIDAUTUMN.content);

const READING_CHINESE_PAYMENTS: SeedContentItem = {
  type: 'reading',
  title: 'Mobile Payments in China',
  title_vi: 'Thanh toán di động ở Trung Quốc (移动支付)',
  level: 'HSK3',
  category: 'daily_life',
  content: `在今天的中国，出门不用带钱包已经变成了一件很普通的事。人们主要使用手机进行支付，最流行的两种工具是微信支付和支付宝。无论是去大商场买衣服，还是在路边买水果，甚至坐公交车和地铁，都可以用手机扫二维码付款。这种支付方式不仅非常方便，不用找零钱，而且也很安全。很多人觉得移动支付让生活变得更简单了。不过，对于一些不会用智能手机的老人来说，他们觉得这也有点儿不方便。`,
  questions: [
    {
      question: '在今天的中国，人们出门主要不用带什么了？',
      options: ['手机', '衣服', '钱包', '钥匙'],
      answer: '钱包',
      explanation: 'The text says: "在今天的中国，出门不用带钱包已经变成了一件很普通的事。"',
    },
    {
      question: '中国最流行的两种移动支付工具是什么？',
      options: [
        '微信支付和支付宝',
        '信用卡和现金',
        '电子邮箱 and 银行卡',
        '百度搜索和淘宝网'
      ],
      answer: '微信支付和支付宝',
      explanation: 'The text says: "最流行的两种工具是微信支付和支付宝。"',
    },
    {
      question: '关于移动支付，以下哪种说法是正确的？',
      options: [
        '去路边买水果不能用手机支付',
        '手机支付经常需要找零钱',
        '对不会用智能手机的老人来说有点儿不方便',
        '移动支付非常不安全'
      ],
      answer: '对不会用智能手机的老人来说有点儿不方便',
      explanation: 'The text says: "不过，对于一些不会用智能手机的老人来说，他们觉得这也有点儿不方便。"',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 43,
};
READING_CHINESE_PAYMENTS.word_count = countWords(READING_CHINESE_PAYMENTS.content);

const LISTENING_ENGLISH_JOBINTERVIEW: SeedContentItem = {
  type: 'listening',
  title: 'Job Interview Conversation',
  title_vi: 'Cuộc phỏng vấn xin việc',
  level: 'B2',
  category: 'career',
  content: `Interviewer: Welcome to TechFlow Solutions, Ms. Smith. I'm Mark. Let's start the interview. Can you introduce yourself briefly?
Candidate: Thank you, Mark. I'm Sarah Smith. I have three years of experience as a software developer. I specialize in React and Node.js.
Interviewer: Great. Why do you want to join our company?
Candidate: TechFlow is known for its innovation in AI tools, and I want to work in a dynamic team that builds cutting-edge products.
Interviewer: Excellent. How do you handle tight deadlines?
Candidate: I prioritize tasks by urgency and coordinate with my team. Communication is key to managing deadlines successfully.
Interviewer: Do you have any questions for us?
Candidate: Yes, what is the team culture like here?
Interviewer: We value collaboration, open communication, and continuous learning. We will contact you by Friday.
Candidate: Thank you, Mark. I look forward to hearing from you.`,
  audio_url: '/audio/listening/b2-job-interview.mp3',
  questions: [
    {
      question: 'What is Sarah Smith\'s profession?',
      options: ['Project Manager', 'Software Developer', 'UX Designer', 'HR Specialist'],
      answer: 'Software Developer',
      explanation: 'Sarah says: "I have three years of experience as a software developer."',
    },
    {
      question: 'Why does Sarah want to join TechFlow Solutions?',
      options: [
        'Because the company offers high salaries',
        'Because she wants to work in a quiet environment',
        'Because of the company\'s innovation in AI tools',
        'Because it is located near her house'
      ],
      answer: 'Because of the company\'s innovation in AI tools',
      explanation: 'Sarah says: "TechFlow is known for its innovation in AI tools, and I want to work in a dynamic team..."',
    },
    {
      question: 'How does Sarah handle tight deadlines?',
      options: [
        'By working overnight alone',
        'By prioritizing tasks and coordinating with her team',
        'By asking for extension immediately',
        'By ignoring low-priority projects'
      ],
      answer: 'By prioritizing tasks and coordinating with her team',
      explanation: 'Sarah says: "I prioritize tasks by urgency and coordinate with my team. Communication is key..."',
    },
  ],
  duration: '6 min',
  word_count: 0,
  sort_order: 44,
};
LISTENING_ENGLISH_JOBINTERVIEW.word_count = countWords(LISTENING_ENGLISH_JOBINTERVIEW.content);

const LISTENING_ENGLISH_HOTELBOOKING: SeedContentItem = {
  type: 'listening',
  title: 'Hotel Booking Phone Call',
  title_vi: 'Cuộc gọi đặt phòng khách sạn',
  level: 'A2',
  category: 'travel',
  content: `Receptionist: Grand Palace Hotel, good morning! How can I help you?
Customer: Hello, I would like to book a room for this weekend.
Receptionist: Certainly. For how many people?
Customer: Just for myself. A single room is fine.
Receptionist: Okay. Checking in on Friday and checking out on Sunday?
Customer: Yes, that's correct.
Receptionist: We have a standard single room for eighty dollars per night, or a deluxe room for one hundred dollars.
Customer: The standard room is perfect. Does it come with free Wi-Fi?
Receptionist: Yes, all rooms have free high-speed Wi-Fi and air conditioning.
Customer: Excellent. I'll book it.
Receptionist: Great. May I have your name and phone number?
Customer: My name is Tom Davis, and my number is 555-1234.
Receptionist: Thank you, Mr. Davis. We will send a confirmation email.
Customer: Thanks a lot. Goodbye!
Receptionist: Goodbye! Have a great day.`,
  audio_url: '/audio/listening/a2-hotel-booking.mp3',
  questions: [
    {
      question: 'What kind of room does the customer book?',
      options: ['Standard single room', 'Deluxe single room', 'Standard double room', 'Suite'],
      answer: 'Standard single room',
      explanation: 'The customer says: "Just for myself. A single room is fine." and then "The standard room is perfect."',
    },
    {
      question: 'How much is the standard single room per night?',
      options: ['$60', '$80', '$100', '$120'],
      answer: '$80',
      explanation: 'The receptionist says: "We have a standard single room for eighty dollars per night..."',
    },
    {
      question: 'Which service is explicitly confirmed to be included in the room?',
      options: ['Free breakfast', 'Free airport shuttle', 'Free Wi-Fi', 'Free gym access'],
      answer: 'Free Wi-Fi',
      explanation: 'The receptionist says: "Yes, all rooms have free high-speed Wi-Fi and air conditioning."',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 45,
};
LISTENING_ENGLISH_HOTELBOOKING.word_count = countWords(LISTENING_ENGLISH_HOTELBOOKING.content);

const LISTENING_JAPANESE_TRAINTICKET: SeedContentItem = {
  type: 'listening',
  title: 'Buying Train Tickets at Tokyo Station',
  title_vi: 'Mua vé tàu Shinkansen tại ga Tokyo (東京駅で切符を買う)',
  level: 'N5',
  category: 'travel',
  content: `客（ジョン）：すみません、京都行きの新幹線の切符を買いたいんですが。
駅員：はい、京都までですね。いつ出発ですか？
客（ジョン）：今日の午後２時ごろ出発したいです。
駅員：午後２時ですね。２時１５分の「のぞみ」があります。指定席にしますか、自由席にしますか？
客（ジョン）：指定席をお願いします。
駅員：わかりました。料金は一万三千九百十円です。
客（ジョン）：クレジットカードは使えますか？
駅員：はい、使えます。こちらにカードを入れて、暗証番号を入力してください。
客（ジョン）：はい、できました。
駅員：ありがとうございます。切符とカードです。１４番線から出発します。`,
  audio_url: '/audio/listening/n5-train-ticket.mp3',
  questions: [
    {
      question: 'ジョンさんはどこへ行きますか？',
      options: ['大阪', '東京', '京都', '広島'],
      answer: '京都',
      explanation: 'John says: "京都行きの新幹線の切符を買いたいんですが" (I want to buy a ticket for Shinkansen heading to Kyoto).',
    },
    {
      question: 'ジョンさんはどのタイプの席を選びましたか？',
      options: ['自由席（じゆうせき）', '指定席（していせき）', 'グリーン車（ぐりーんしゃ）', '立ち席（たちせき）'],
      answer: '指定席（していせき）',
      explanation: 'John says: "指定席をお願いします" (Reserved seat please).',
    },
    {
      question: '料金はいくらですか？',
      options: ['10,910円', '12,910円', '13,910円', '14,910円'],
      answer: '13,910円',
      explanation: 'The clerk says: "料金は一万三千九百十円（13,910円）です。"',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 46,
};
LISTENING_JAPANESE_TRAINTICKET.word_count = countWords(LISTENING_JAPANESE_TRAINTICKET.content);

const LISTENING_JAPANESE_DOCTOR: SeedContentItem = {
  type: 'listening',
  title: 'Talking with a Japanese Doctor',
  title_vi: 'Hội thoại với bác sĩ Nhật Bản (病院での会話)',
  level: 'N4',
  category: 'daily_life',
  content: `医者：ジョンさん、今日はどうされましたか？
客（ジョン）：一昨日から熱があって、喉がとても痛いです。
医者：そうですか。咳や鼻水は出ますか？
客（ジョン）：咳は少し出ますが、鼻水は出ません。
医者：ちょっと熱を測りましょう。...３８度２分ですね。少し高いです。喉も見せてください。あー、喉が赤く腫れていますね。
客（ジョン）：インフルエンザでしょうか。
医者：念のため検査をしましょう。...検査の結果、普通の風邪ですね。
客（ジョン）：よかったです。
医者：熱を下げる薬と、喉の薬を３日分出します。薬は食後に飲んでください。今日は温かくして早く寝てください。
客（ジョン）：ありがとうございました。お大事に。`,
  audio_url: '/audio/listening/n4-doctor.mp3',
  questions: [
    {
      question: 'ジョンさんはいつから熱がありますか？',
      options: ['今日から', '昨日から', '一昨日（おととい）から', '先週から'],
      answer: '一昨日（おととい）から',
      explanation: 'John says: "一昨日から熱があって..." (I have a fever since the day before yesterday...).',
    },
    {
      question: 'ジョンさんの病名は何ですか？',
      options: ['インフルエンザ', '普通の風邪（かぜ）', 'コロナウイルス', '胃炎（いえん）'],
      answer: '普通の風邪（かぜ）',
      explanation: 'The doctor says: "検査の結果、普通の風邪ですね" (As a result of the test, it is a common cold).',
    },
    {
      question: '薬はいつ飲まなければなりませんか？',
      options: ['食前（しょくぜん）', '食後（しょくご）', '寝る前', 'いつでも良い'],
      answer: '食後（しょくご）',
      explanation: 'The doctor says: "薬は食後に飲んでください" (Please take the medicine after meals).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 47,
};
LISTENING_JAPANESE_DOCTOR.word_count = countWords(LISTENING_JAPANESE_DOCTOR.content);

const LISTENING_CHINESE_RESTAURANT: SeedContentItem = {
  type: 'listening',
  title: 'Ordering Food in a Chinese Restaurant',
  title_vi: 'Gọi món ở nhà hàng Trung Quốc (在饭馆点菜)',
  level: 'HSK2',
  category: 'daily_life',
  content: `服务员：下午好！两位吗？请这边坐。这是菜单。
张明：谢谢。大卫，你想吃什么？
大卫：我是第一次来这家饭馆，你来点吧。我喜欢吃辣的。
张明：好。服务员，我们要一个麻婆豆腐，一个北京烤鸭，还要一个炒米饭。
服务员：好的。请问喝点儿什么？我们有热茶、果汁和啤酒。
大卫：我要一瓶冰啤酒，谢谢。
张明：我要一杯热茶。先这些吧。
服务员：好的。一个麻婆豆腐，一个烤鸭，一个炒米饭，一瓶啤酒，一杯热茶。请稍等。`,
  audio_url: '/audio/listening/hsk2-restaurant.mp3',
  questions: [
    {
      question: '大卫喜欢吃什么口味 of 菜？',
      options: ['甜的', '辣的', '咸的', '酸的'],
      answer: '辣的',
      explanation: 'David says: "我喜欢吃辣的" (I like eating spicy food).',
    },
    {
      question: '他们没有点以下哪种食物？',
      options: ['麻婆豆腐', '北京烤鸭', '炒米饭', '水饺'],
      answer: '水饺',
      explanation: 'They ordered Mapo Tofu (麻婆豆腐), Beijing Roast Duck (北京烤鸭), and Fried Rice (炒米饭). Dumplings (水饺) were not ordered.',
    },
    {
      question: '大卫要喝什么饮料？',
      options: ['热茶', '果汁', '冰啤酒', '可口可乐'],
      answer: '冰啤酒',
      explanation: 'David says: "我要一瓶冰啤酒" (I want a bottle of cold beer).',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 48,
};
LISTENING_CHINESE_RESTAURANT.word_count = countWords(LISTENING_CHINESE_RESTAURANT.content);

const LISTENING_CHINESE_DIRECTIONS: SeedContentItem = {
  type: 'listening',
  title: 'Asking Directions in Beijing',
  title_vi: 'Hỏi đường ở Bắc Kinh (在北京问路)',
  level: 'HSK2',
  category: 'travel',
  content: `大卫：你好，请问去天安门广场怎么走？
路人：天安门广场啊，离这儿有点儿远。你可以坐地铁。
大卫：请问最近的地铁站在哪儿？
路人：往前走大约两百米，过马路，就可以看到地铁站的入口了，那是四号线。
大卫：坐地铁需要多长时间？
路人：大约二十分钟。坐到西单站，然后换乘一号线，再坐两站就到了。
大卫：买票可以用手机支付吗？
路人：可以的，用手机微信或者支付宝都可以扫码买票。
大卫：非常感谢你！
路人：不客气，祝你旅游愉快！`,
  audio_url: '/audio/listening/hsk2-directions.mp3',
  questions: [
    {
      question: '大卫想去哪里？',
      options: ['故宫', '天安门广场', '颐和园', '北京大学'],
      answer: '天安门广场',
      explanation: 'David asks: "请问去天安门广场怎么走？" (Excuse me, how do I get to Tiananmen Square?).',
    },
    {
      question: '最近的地铁站在哪里？',
      options: [
        '过马路再走五百米',
        '就在马路对面，往后退一百米',
        '往前走大约两百米，过马路',
        '需要坐公交车去'
      ],
      answer: '往前走大约两百米，过马路',
      explanation: 'The pedestrian says: "往前走大约两百米，过马路，就可以看到地铁站的入口了..."',
    },
    {
      question: '关于坐地铁的换乘，路人是怎么建议的？',
      options: [
        '直接坐四号线到天安门，不用换乘',
        '坐四号线到西单站，换乘一号线',
        '坐二号线到东单站，换乘五号线',
        '先坐公交，再去火车站换乘'
      ],
      answer: '坐四号线到西单站，换乘一号线',
      explanation: 'The pedestrian says: "坐到西单站，然后换乘一号线，再坐两站就到了。"',
    },
  ],
  duration: '5 min',
  word_count: 0,
  sort_order: 49,
};
LISTENING_CHINESE_DIRECTIONS.word_count = countWords(LISTENING_CHINESE_DIRECTIONS.content);

// ── Export ──────────────────────────────────────────────────────────────────

export const CONTENT_CATALOG: SeedContentItem[] = [
  // Reading passages (10 + 2 new + 4 extra + 6 new)
  READING_MORNING_ROUTINE,
  READING_AT_THE_SUPERMARKET,
  READING_MY_PET,
  READING_A_GIFT_FOR_MUM,
  READING_TRAVEL_BLOG,
  READING_WEEKEND_PLANS,
  READING_SUNDAY_FAMILY_DINNER,
  READING_JOB_INTERVIEW_TIPS,
  READING_AI_TUTORS,
  READING_CLIMATE_CHANGE,
  READING_JAPANESE_FESTIVAL,
  READING_CHINESE_SPRING_FESTIVAL,
  READING_JAPANESE_TRAVEL,
  READING_CHINESE_TEA,
  READING_ENGLISH_HEALTH,
  READING_KOREAN_KPOP,
  READING_ENGLISH_INTERNET,
  READING_ENGLISH_TOURISM,
  READING_JAPANESE_GARDENS,
  READING_JAPANESE_MANNERS,
  READING_CHINESE_MIDAUTUMN,
  READING_CHINESE_PAYMENTS,

  // Grammar lessons (7 + 2 new)
  GRAMMAR_ARTICLES,
  GRAMMAR_PRESENT_SIMPLE_VS_CONTINUOUS,
  GRAMMAR_PAST_SIMPLE,
  GRAMMAR_CONDITIONALS,
  GRAMMAR_PASSIVE_VOICE,
  GRAMMAR_REPORTED_SPEECH,
  GRAMMAR_RELATIVE_CLAUSES,
  GRAMMAR_JAPANESE_TE_FORM,
  GRAMMAR_CHINESE_LE,

  // Listening dialogues (6 + 2 new + 4 extra + 6 new)
  LISTENING_ORDERING_CAFE,
  LISTENING_AT_THE_DOCTOR,
  LISTENING_BOOKING_HOTEL,
  LISTENING_ASKING_DIRECTIONS,
  LISTENING_JOB_INTERVIEW,
  LISTENING_MAKING_PLANS,
  LISTENING_JAPANESE_DIRECTIONS,
  LISTENING_CHINESE_MEETING,
  LISTENING_JAPANESE_RESTAURANT,
  LISTENING_CHINESE_WEATHER,
  LISTENING_ENGLISH_AIRPORT,
  LISTENING_KOREAN_INTRO,
  LISTENING_ENGLISH_JOBINTERVIEW,
  LISTENING_ENGLISH_HOTELBOOKING,
  LISTENING_JAPANESE_TRAINTICKET,
  LISTENING_JAPANESE_DOCTOR,
  LISTENING_CHINESE_RESTAURANT,
  LISTENING_CHINESE_DIRECTIONS,
];
