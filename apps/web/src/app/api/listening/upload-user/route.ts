/* User listening upload — validate locally, then proxy storage to the backend.
 *
 * Storage adapter and ownership live in apps/api/src/files/. This route never
 * writes to public/uploads: doing so from the web process would bypass the
 * backend's JWT guard, signature checks and owner-scoped object keys.
 *
 * Validation happens before /tokens/consume so malformed requests are not
 * charged. The backend is the source of truth for the upload (and for token
 * consumption); its resource URL is used for the lesson's audioUrl.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAuthHeader } from '@/lib/auth/jwt-verify';
import { createLesson } from '@/lib/cms-storage';
import { verifyListeningQuestions, youtubeListeningSource } from '@/lib/listening-source';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * Decoded-byte budget. Keep in lockstep with MAX_UPLOAD_BYTES in
 * apps/api/src/files/file-validation.ts (the backend rejects anything larger).
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_TRANSCRIPT_CHARS = 20_000;
const TIMEOUT_MS = 30_000;

// Keep in sync with LessonLanguage in apps/web/src/lib/types/cms.ts. The UI
// currently offers more languages, which cannot be stored by cms-storage;
// reject them here instead of persisting an invalid record.
const ALLOWED_LANGUAGES = ['english', 'japanese', 'chinese'] as const;
const ALLOWED_LEVELS = [
  'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'N5', 'N4', 'N3', 'N2', 'N1',
  'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6',
] as const;
const ALLOWED_CATEGORIES = [
  'conversation', 'announcement', 'lecture', 'interview', 'news',
  'academic', 'business', 'daily-life',
] as const;

const AUDIO_MIME_TYPES: readonly string[] = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
  'audio/flac', 'audio/x-flac',
];
const MIME_TO_FORMAT: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
};

function getLangCode(language: string): string {
  switch (language) {
    case 'japanese': return 'ja';
    case 'chinese': return 'zh';
    case 'korean': return 'ko';
    case 'french': return 'fr';
    case 'spanish': return 'es';
    case 'vietnamese': return 'vi';
    default: return 'en';
  }
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(';')[0].trim().toLowerCase();
}

function startsWith(buffer: Uint8Array, offset: number, ascii: string): boolean {
  const bytes = Buffer.from(ascii, 'ascii');
  return buffer.length >= offset + bytes.length &&
    bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Verify that the payload really is the format the client declared.
 * MIME headers are attacker-controlled; the leading bytes are not.
 * Keep these signatures in sync with hasAudioSignature() in
 * apps/api/src/files/file-validation.ts (the backend re-checks them).
 */
function matchesAudioFormat(buffer: Buffer, format: string): boolean {
  switch (format) {
    case 'mp3':
      return startsWith(buffer, 0, 'ID3') ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 &&
          (buffer[1] & 0x06) !== 0x00 && (buffer[1] & 0x18) !== 0x08);
    case 'wav':
      return startsWith(buffer, 0, 'RIFF') && startsWith(buffer, 8, 'WAVE');
    case 'ogg':
      return startsWith(buffer, 0, 'OggS');
    case 'm4a':
      return buffer.length >= 12 && startsWith(buffer, 4, 'ftyp') &&
        ['isom', 'iso2', 'mp41', 'mp42', 'M4A ', 'M4B ', 'dash']
          .includes(buffer.subarray(8, 12).toString('ascii'));
    case 'aac':
      return startsWith(buffer, 0, 'ADIF') ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0);
    case 'flac':
      return startsWith(buffer, 0, 'fLaC');
    default:
      return false;
  }
}

function readField(formData: FormData | undefined, key: string): string | undefined {
  const value = formData?.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bounded(
  value: string | undefined,
  fallback: string,
  max: number,
): string | undefined {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function fromAllowlist<T extends string>(
  value: string | undefined,
  fallback: T,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Extract the owner-scoped object key from the backend's upload URL. */
function keyFromUploadUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/\/uploads\/([^/]+\/[^/]+\.[a-z0-9]+)$/);
    return match?.[1];
  } catch {
    return undefined;
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
  if (isYouTube && (!youtube || !youtube.success)) {
    return NextResponse.json({
      error: 'Hãy nhập link video YouTube và bản chép lời của video (tối đa 20.000 ký tự).',
    }, { status: 400 });
  }

  let formData: FormData | undefined;
  let file: File | undefined;
  let bytes: Buffer | undefined;
  let format: string | undefined;

  if (!isYouTube) {
    // Bound Content-Length before Next.js buffers the multipart body.
    const declaredLength = Number.parseInt(req.headers.get('content-length') || '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `Chọn tệp âm thanh tối đa ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 400 });
    }
    formData = await req.formData().catch(() => undefined);
    const audio = formData?.get('file');
    file = audio instanceof File ? audio : undefined;
    if (!file || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({
        error: `Chọn tệp âm thanh từ 1 byte đến ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      }, { status: 400 });
    }

    // Trust the MIME + leading bytes, never the client filename. The backend
    // generates the object key from the authenticated owner id.
    const mimeType = normalizeMimeType(file.type);
    format = MIME_TO_FORMAT[mimeType];
    if (!format || !AUDIO_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({
        error: 'Định dạng âm thanh không được hỗ trợ (MP3, WAV, OGG, M4A, AAC, FLAC).',
      }, { status: 400 });
    }
    bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesAudioFormat(bytes, format)) {
      return NextResponse.json({ error: 'Nội dung tệp không khớp định dạng âm thanh đã khai báo.' }, { status: 400 });
    }
  }

  // Validate every field BEFORE charging tokens or calling any provider.
  const source = youtube?.data;
  const language = fromAllowlist(
    source?.language ?? readField(formData, 'language') ?? 'english',
    'english',
    ALLOWED_LANGUAGES,
  );
  const level = fromAllowlist(
    source?.level ?? readField(formData, 'level') ?? 'B1',
    'B1',
    ALLOWED_LEVELS,
  );
  const category = fromAllowlist(
    source?.category ?? readField(formData, 'category') ?? 'conversation',
    'conversation',
    ALLOWED_CATEGORIES,
  );
  const rawTranscript = source?.transcript ?? readField(formData, 'transcript') ?? '';
  let title = bounded(
    source?.title ?? readField(formData, 'title'),
    isYouTube ? 'YouTube Listening Practice' : 'Uploaded Audio Practice',
    200,
  );

  if (!language || !level || !category || !title ||
      rawTranscript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json({
      error: `Thông tin bài học không hợp lệ (ngôn ngữ, trình độ, thể loại, tiêu đề tối đa 200 ký tự, lời thoại tối đa ${MAX_TRANSCRIPT_CHARS} ký tự).`,
    }, { status: 400 });
  }
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: 'Dịch vụ tạo bài nghe đang tạm thời gián đoạn.' }, { status: 503 });
  }

  // Forward the caller's idempotency key to both side-effecting calls so a
  // retry cannot consume tokens twice or create duplicate uploads.
  const idempotencyKey = req.headers.get('idempotency-key') || crypto.randomUUID();
  const authHeaders: Record<string, string> = { Authorization: authHeader! };

  try {
    const consumeRes = await fetch(`${API_URL}/tokens/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ feature: 'listening_generate', cost: 8 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

  let audioUrl = source?.youtubeUrl ?? '';
  let uploadedKey: string | undefined;
  let transcriptText = source?.transcript.trim() ?? '';
  // title was checked above; pin the narrowed value for the DTO below.
  const validatedTitle: string = title;

  try {
    if (file && bytes && format) {
      // Transcribe via Groq Whisper using the exact validated bytes.
      try {
        const groqFormData = new FormData();
        groqFormData.append('file', new File(
          [new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)],
          `${crypto.randomUUID()}.${format}`,
          { type: normalizeMimeType(file.type) },
        ));
        groqFormData.append('model', 'whisper-large-v3');
        groqFormData.append('language', getLangCode(language));

        const transcribeRes = await fetch(WHISPER_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          body: groqFormData,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!transcribeRes.ok) {
          const errText = await transcribeRes.text();
          console.error('[Whisper API] Transcription error:', transcribeRes.status, errText);
          throw new Error('Groq Whisper transcription failed');
        }

        const transJson = await transcribeRes.json();
        transcriptText = typeof transJson.text === 'string' ? transJson.text.trim() : '';
        if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
          return NextResponse.json({
            error: `Lời thoại quá dài (tối đa ${MAX_TRANSCRIPT_CHARS} ký tự).`,
          }, { status: 422 });
        }
      } catch (err) {
        if (err instanceof NextResponse) return err;
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
        Authorization: `Bearer ${GROQ_API_KEY}`,
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

    if (file && bytes && format) {
      // The backend owns storage: it validates the signature again and derives
      // an owner-scoped key from the authenticated user id.
      try {
        const uploadFd = new FormData();
        uploadFd.append('file', new File(
          [new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)],
          `${crypto.randomUUID()}.${format}`,
          { type: normalizeMimeType(file.type) },
        ));
        const uploadRes = await fetch(`${API_URL}/files/upload`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Idempotency-Key': idempotencyKey,
          },
          body: uploadFd,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!uploadRes.ok) {
          const status = uploadRes.status === 401 || uploadRes.status === 403 ? 401 : 502;
          return NextResponse.json({
            error: status === 401 ? 'Unauthorized' : 'Upload service unavailable',
          }, { status });
        }
        const json = await uploadRes.json();
        audioUrl = typeof json?.url === 'string' ? json.url : typeof json?.data?.url === 'string' ? json.data.url : '';
        if (!audioUrl) {
          return NextResponse.json({ error: 'Upload service unavailable' }, { status: 502 });
        }
        uploadedKey = keyFromUploadUrl(audioUrl);
      } catch (err) {
        console.error('[Listening User Upload API] Upload error:', err);
        return NextResponse.json({ error: 'Upload service unavailable' }, { status: 502 });
      }
    }

    const slug = `user-listening-${crypto.randomBytes(4).toString('hex')}`;
    const lessonDto = {
      type: 'listening' as const,
      language,
      level,
      title: validatedTitle,
      titleVi: aiResult.titleVi || validatedTitle,
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

    const createdLesson = await createLesson(lessonDto);
    return NextResponse.json({ data: createdLesson });
  } catch (error) {
    console.error('[Listening User Upload API] Error:', error);
    // Remove the backend-stored file if lesson creation failed, so a failed
    // request does not leave an orphaned, owner-scoped audio object behind.
    if (uploadedKey) {
      try {
        await fetch(`${API_URL}/files/${encodeURIComponent(uploadedKey)}`, {
          method: 'DELETE',
          headers: authHeaders,
          signal: AbortSignal.timeout(5_000),
        });
      } catch (cleanupError) {
        console.error('[Listening User Upload API] Orphan cleanup failed:', cleanupError);
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
