import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
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
    // Validate the request before charging tokens so malformed input is free.
    const body = await req.json();
    const { topic, level, category } = body as {
      topic?: string;
      level?: string;
      category?: string;
    };
    if (typeof topic !== 'string' || topic.trim().length === 0 || topic.length > 500) {
      return NextResponse.json({ error: 'Invalid topic' }, { status: 400 });
    }

    // Stable per-request idempotency key: retries of the same user request (or
    // a retried consume fetch) must not charge the user twice.
    const idempotencyKey = createHash('sha256')
      .update(`${user.id}:listening_generate:${topic}:${level ?? ''}:${category ?? ''}`)
      .digest('hex');

    // Call backend /tokens/consume
    try {
      const consumeRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/tokens/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader!,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          feature: 'listening_generate',
          cost: 8,
        }),
      });

      if (!consumeRes.ok) {
        if (consumeRes.status === 400) {
          return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to consume tokens' }, { status: consumeRes.status });
      }
    } catch (err) {
      console.error('[Listening API] Token consume error:', err);
      return NextResponse.json({ error: 'Failed to connect to token service' }, { status: 500 });
    }

    const systemPrompt = `You are an English listening comprehension exercise generator. Create a listening exercise for an ESL student.

Topic: "${topic || 'general conversation'}"
Student level: ${level || 'B1'}
Category: ${category || 'conversation'}

Generate a listening exercise with the following EXACT JSON format:
{
  "title": "<exercise title in English>",
  "titleVi": "<exercise title in Vietnamese>",
  "level": "${level || 'B1'}",
  "category": "${category || 'conversation'}",
  "duration": "<estimated duration like 2-3 min>",
  "transcript": "<a natural English dialogue or monologue, 100-200 words appropriate for the level>",
  "vocabulary": [
    { "word": "<key word>", "definition": "<English definition>", "definitionVi": "<Vietnamese definition>" },
    { "word": "<key word>", "definition": "<English definition>", "definitionVi": "<Vietnamese definition>" }
  ],
  "questions": [
    { "question": "<comprehension question>", "options": ["<A>", "<B>", "<C>", "<D>"], "correctAnswer": <0-3 index>, "explanation": "<why this is correct>" },
    { "question": "<comprehension question>", "options": ["<A>", "<B>", "<C>", "<D>"], "correctAnswer": <0-3 index>, "explanation": "<why this is correct>" },
    { "question": "<comprehension question>", "options": ["<A>", "<B>", "<C>", "<D>"], "correctAnswer": <0-3 index>, "explanation": "<why this is correct>" }
  ]
}

Generate 4-6 vocabulary items and 3-5 questions. Make the transcript natural and engaging.
The transcript should be suitable for text-to-speech reading.
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
          { role: 'user', content: `Generate a listening exercise about: ${topic || 'an interesting everyday topic'}` },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Listening Generate API] Groq error:', response.status, errText);
      return NextResponse.json({ error: 'Groq API error' }, { status: 502 });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({ data: parsed });
    } catch {
      // Log the raw completion server-side only. Never echo model output to the
      // browser: it may contain injected markup or leaked system-prompt text.
      console.error('[Listening Generate API] Invalid AI JSON:', content.slice(0, 1000));
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 });
    }
  } catch (error) {
    console.error('[Listening Generate API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
