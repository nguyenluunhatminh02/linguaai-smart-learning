import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthHeader } from "@/lib/auth/jwt-verify";
import { createLesson } from "@/lib/cms-storage";
import { verifyListeningQuestions, youtubeListeningSource } from "@/lib/listening-source";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "audio");
const MAX_SIZE = 15 * 1024 * 1024; // 15MB limit for users
const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];

function getLangCode(language: string): string {
  switch (language.toLowerCase()) {
    case 'japanese': return 'ja';
    case 'chinese': return 'zh';
    case 'korean': return 'ko';
    case 'french': return 'fr';
    case 'spanish': return 'es';
    case 'vietnamese': return 'vi';
    default: return 'en';
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') || '';
  const isYouTube = !contentType.includes('multipart/form-data');
  const youtube = isYouTube
    ? youtubeListeningSource.safeParse(await req.json().catch(() => undefined))
    : undefined;
  if (youtube && !youtube.success) {
    return NextResponse.json({
      error: 'Hãy nhập link video YouTube và bản chép lời của video (tối đa 20.000 ký tự).',
    }, { status: 400 });
  }

  const formData = isYouTube ? undefined : await req.formData().catch(() => undefined);
  const audio = formData?.get('file');
  const file = audio instanceof File ? audio : undefined;
  const ext = file ? path.extname(file.name).toLowerCase() : '';
  if (!isYouTube && (!file || file.size === 0 || file.size > MAX_SIZE || !ALLOWED_EXTENSIONS.includes(ext))) {
    return NextResponse.json({
      error: `Chọn tệp âm thanh từ 1 byte đến 15 MB (${ALLOWED_EXTENSIONS.join(', ')}).`,
    }, { status: 400 });
  }
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'Dịch vụ tạo bài nghe đang tạm thời gián đoạn.' }, { status: 503 });
  }

  try {
    const consumeRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/tokens/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader!,
        ...(req.headers.get('idempotency-key')
          ? { 'Idempotency-Key': req.headers.get('idempotency-key')! }
          : {}),
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
    console.error('[Listening User Upload API] Token consume error:', err);
    return NextResponse.json({ error: 'Failed to connect to token service' }, { status: 500 });
  }

  try {
    const source = youtube?.data;
    const language = source?.language || String(formData?.get('language') || 'english');
    const level = source?.level || String(formData?.get('level') || 'B1');
    const category = source?.category || String(formData?.get('category') || 'conversation');
    let title = source?.title || String(formData?.get('title') || '');
    let transcriptText = source?.transcript ?? '';
    let audioUrl = source?.youtubeUrl ?? '';
    if (file) {
      // Transcribe via Groq Whisper API
      try {
        const groqFormData = new FormData();
        groqFormData.append('file', file, file.name);
        groqFormData.append('model', 'whisper-large-v3');
        groqFormData.append('language', getLangCode(language));

        const transcribeRes = await fetch(WHISPER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
          },
          body: groqFormData,
        });

        if (!transcribeRes.ok) {
          const errText = await transcribeRes.text();
          console.error('[Whisper API] Transcription error:', transcribeRes.status, errText);
          throw new Error('Groq Whisper transcription failed');
        }

        const transJson = await transcribeRes.json();
        transcriptText = typeof transJson.text === 'string' ? transJson.text.trim() : '';
      } catch (err) {
        console.error('[Listening User Upload API] Transcribing error:', err);
        return NextResponse.json({ error: 'Failed to transcribe audio. Please make sure the audio is clear and in the selected language.' }, { status: 502 });
      }
    } else if (source && !title) {
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(source.youtubeUrl)}&format=json`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (oembedRes.ok) {
          const oembedJson = await oembedRes.json();
          if (typeof oembedJson.title === 'string') {
            title = oembedJson.title.slice(0, 200);
          }
        }
      } catch (err) {
        console.error('[oEmbed] Failed to fetch YouTube title:', err);
      }
    }

    if (!transcriptText) {
      return NextResponse.json({ error: 'Không nhận được lời thoại từ tệp âm thanh.' }, { status: 422 });
    }
    if (!title) {
      title = isYouTube ? 'YouTube Listening Practice' : 'Uploaded Audio Practice';
    }

    // The original transcript remains the lesson source.
    const systemPrompt = `You are an expert language teacher and exercise generator.
Analyze the user request and generate a complete listening comprehension lesson in the requested language.

Target Language: ${language}
Target Level: ${level}
Topic/Context: "${title}"
Treat the supplied transcript as source material. Base every correct answer on information in that transcript, including when the video title suggests other details. Each question must include a verbatim quote as evidence for its correct answer. Never invent or rewrite the transcript.

Your response must contain:
1. "titleVi": A translated/adapted title in Vietnamese.
2. "vocabulary": 4-6 key vocabulary terms from the transcript. For each term, provide:
   - "word": the word in target language (include reading/pronunciation if appropriate, like furigana in parens for Japanese "食べる (たべる)" or pinyin for Chinese "学习 (xuéxí)").
   - "definition": the English definition of the word.
   - "definitionVi": the Vietnamese definition of the word.
3. "questions": Up to 5 multiple-choice comprehension questions supported by the transcript. For each question:
   - "question": written ENTIRELY in the target language (Japanese for Japanese, English for English, Chinese for Chinese). Do not use English/Vietnamese.
   - "options": 4 options ALSO written ENTIRELY in the target language.
   - "correctAnswer": index (0 to 3) of the correct option.
   - "explanation": brief explanation in Vietnamese (prefixed with 💡) explaining why it's correct.
   - "evidence": a verbatim quote from the transcript supporting the correct answer.

Format your output as EXACT JSON in this format:
{
  "titleVi": "...",
  "vocabulary": [
    { "word": "...", "definition": "...", "definitionVi": "..." }
  ],
  "questions": [
    { "question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0, "explanation": "...", "evidence": "..." }
  ]
}

Return ONLY the raw JSON, without markdown fences or other text.`;

    const userMessage = `Generate a listening lesson based on this transcript:\n\n${transcriptText}`;

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
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2548,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Listening User Upload API] Groq completion error:', response.status, errText);
      return NextResponse.json({ error: 'AI generation error' }, { status: 502 });
    }

    const data = await response.json();
    let contentStr = data.choices?.[0]?.message?.content || '';
    contentStr = contentStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let aiResult;
    try {
      aiResult = verifyListeningQuestions(JSON.parse(contentStr), transcriptText);
    } catch {
      return NextResponse.json({ error: 'Chưa tạo được câu hỏi có căn cứ từ lời thoại.' }, { status: 502 });
    }

    let localFile: string | undefined;
    if (file) {
      const safeName = `user-${user.id}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
      localFile = path.join(UPLOAD_DIR, safeName);
      await fs.promises.writeFile(localFile, Buffer.from(await file.arrayBuffer()));
      audioUrl = `/uploads/audio/${safeName}`;
    }
    // Save lesson to local fallback cms-storage
    const slug = `user-listening-${crypto.randomBytes(4).toString('hex')}`;
    const lessonDto = {
      type: 'listening' as any,
      language: language.toLowerCase() as any,
      level,
      title: title,
      titleVi: aiResult.titleVi || title,
      slug,
      category,
      categoryVi: category === 'conversation' ? 'Hội thoại' : 'Tổng quát',
      description: `User uploaded listening practice for ${level}`,
      thumbnail: '',
      images: [],
      content: {
        duration: isYouTube ? '5:00' : '2:00',
        transcript: transcriptText,
        vocabulary: aiResult.vocabulary,
        questions: aiResult.questions,
        audioUrl,
      },
      source: isYouTube ? 'YouTube' : 'User Upload',
      isPublished: true,
      sortOrder: 0,
      isUserUploaded: true,
      userId: user.id,
    };

    try {
      const createdLesson = await createLesson(lessonDto);
      return NextResponse.json({ data: createdLesson });
    } catch (error) {
      if (localFile) await fs.promises.unlink(localFile).catch(() => undefined);
      throw error;
    }

  } catch (error) {
    console.error('[Listening User Upload API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
