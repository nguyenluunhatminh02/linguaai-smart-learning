import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { transcript, language, level } = body as {
      transcript?: string;
      language?: string;
      level?: string;
    };

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const systemPrompt = `You are an expert language teacher and exercise generator. 
Your task is to analyze the provided transcript (in the specified language) and generate high-quality vocabulary items and comprehension questions.

Language of the transcript: ${language || 'english'}
Student level: ${level || 'B1'}

Based on the provided transcript, generate:
1. 4-6 key vocabulary words from the text. For each word, provide:
   - "word": the word in the target language (if Japanese, include reading/furigana in parenthesis like "食べる (たべる)"; if Chinese, include pinyin like "练习 (liànxí)").
   - "definition": the English definition of the word.
   - "definitionVi": the Vietnamese definition of the word.
2. 3-5 multiple-choice comprehension questions about the content of the transcript. For each question:
   - "question": the question written IN THE SAME LANGUAGE as the transcript (Japanese questions for Japanese, Chinese questions for Chinese, English questions for English). Do NOT translate to English.
   - "options": 4 answer options ALSO written IN THE SAME LANGUAGE as the transcript. Do NOT translate to English.
   - "correctAnswer": index of the correct option (0 to 3).
   - "explanation": a brief explanation in Vietnamese (prefixed with 💡) explaining why this answer is correct, quoting the relevant sentence from the transcript.

Format your output as EXACT JSON in this format:
{
  "vocabulary": [
    { "word": "...", "definition": "...", "definitionVi": "..." }
  ],
  "questions": [
    { "question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0, "explanation": "..." }
  ]
}

Return ONLY the raw JSON, without markdown fences or other text.`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Generate from Transcript API] Groq error:', response.status, errText);
      return NextResponse.json({ error: 'Groq API error' }, { status: 502 });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({ data: parsed });
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: content }, { status: 502 });
    }
  } catch (error) {
    console.error('[Generate from Transcript API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
