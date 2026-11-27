import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthHeader } from "@/lib/auth/jwt-verify";

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Call backend /tokens/consume
    try {
      const consumeRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/tokens/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader!,
        },
        body: JSON.stringify({
          feature: 'translation_ai',
          cost: 3,
        }),
      });

      if (!consumeRes.ok) {
        if (consumeRes.status === 400) {
          return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to consume tokens' }, { status: consumeRes.status });
      }
    } catch (err) {
      console.error('[Translation API] Token consume error:', err);
      return NextResponse.json({ error: 'Failed to connect to token service' }, { status: 500 });
    }

    const body = await req.json();
    const { topic, level, category, count } = body as {
      topic?: string;
      level?: string;
      category?: string;
      count?: number;
    };

    const numSentences = Math.min(count || 5, 10);

    const systemPrompt = `You are a Vietnamese-to-English translation exercise generator for ESL students.

Topic: "${topic || 'daily life'}"
Student level: ${level || 'B1'}
Category: ${category || 'daily'}
Number of sentences: ${numSentences}

Generate translation practice sentences. Return ONLY a JSON object with this EXACT format:
{
  "title": "<lesson title in English>",
  "titleVi": "<lesson title in Vietnamese>",
  "level": "${level || 'B1'}",
  "category": "${category || 'daily'}",
  "categoryVi": "<category in Vietnamese>",
  "sentences": [
    {
      "id": 1,
      "vi": "<Vietnamese sentence>",
      "en": "<correct English translation>",
      "alts": ["<alternative correct translation 1>", "<alternative correct translation 2>"],
      "hint": "<a helpful hint for the student>"
    }
  ]
}

Guidelines:
- Sentences should be natural and commonly used
- Difficulty should match the level (A1=very basic, B1=intermediate, C1=advanced)
- Provide 1-3 alternative correct translations for each sentence
- Hints should help without giving away the answer
- Vietnamese sentences should be natural Vietnamese, not word-for-word translations
Return ONLY the JSON, no markdown fences.`;

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
          { role: 'user', content: `Generate ${numSentences} translation sentences about: ${topic || 'everyday situations'}` },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Translation Generate API] Groq error:', response.status, errText);
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
    console.error('[Translation Generate API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
