import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { verifyAuthHeader } from "@/lib/auth/jwt-verify";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function POST(req: NextRequest) {
  // S7: Require Bearer token (set by apiClient) to prevent unauthenticated abuse
  // of Groq quota. Validation matches the CMS route pattern; full JWT verification
  // is delegated to NestJS API for endpoints that touch DB.
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { level, category, language } = body as {
      level?: string;
      category?: string;
      language?: string;
    };
    const lang = (language || 'english').toLowerCase();

    // Charge the backend token wallet before calling Groq. Use a stable
    // per-request key so retries of the same request do not double-charge.
    const idempotencyKey = createHash('sha256')
      .update(`${user.id}:speaking_topic:${lang}:${level ?? ''}:${category ?? ''}`)
      .digest('hex');
    try {
      const consumeRes = await fetch(`${API_URL}/tokens/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader!,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ feature: 'speaking_feedback' }),
      });

      if (!consumeRes.ok) {
        if (consumeRes.status === 400) {
          return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to consume tokens' }, { status: consumeRes.status });
      }
    } catch (err) {
      console.error('[Speaking Topic API] Token consume error:', err);
      return NextResponse.json({ error: 'Failed to connect to token service' }, { status: 500 });
    }

    const systemPrompt = `You are a speaking practice assistant. Generate a speaking prompt for the student.

Practice language: ${lang}
Student level: ${level || 'B1'}
Category: ${category || 'general'}

The "topic", "prompt", "tips", and "samplePhrases" fields MUST be written entirely in ${lang}.

Return ONLY a JSON object with this EXACT format:
{
  "topic": "<short topic title>",
  "prompt": "<what the student should talk about - 1-2 sentences>",
  "tips": ["<tip1>", "<tip2>", "<tip3>"],
  "samplePhrases": ["<phrase1>", "<phrase2>", "<phrase3>"],
  "duration": <recommended seconds, 30-120>,
  "difficulty": "<easy|medium|hard>"
}

Make the topic interesting and relevant. Tips should help them structure their response. Sample phrases should be useful expressions.
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
          { role: 'user', content: 'Give me a speaking practice topic.' },
        ],
        temperature: 1,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Groq API error' }, { status: 502 });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({ data: parsed });
    } catch {
      return NextResponse.json({ data: { topic: 'Error', prompt: content, tips: [], samplePhrases: [], duration: 60, difficulty: 'medium' } });
    }
  } catch (error) {
    console.error('[Speaking Topic API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
