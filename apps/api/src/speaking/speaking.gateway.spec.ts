// @ts-nocheck
/**
 * SEC-02 regression for the speaking WebSocket pipeline.
 *
 * The gateway authenticates every socket from its own JWT and uses that
 * socket's `_userId` for token consumption and submission persistence. These
 * tests pin the identity boundary: an anonymous socket cannot reach paid work,
 * a user A socket never writes a row for user B, revocation aborts persistence,
 * and disconnect closes the abort signal before the DB write.
 */
import { WebSocket } from 'ws';

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: jest.fn() } },
    chat: { completions: { create: jest.fn() } },
  })),
}));

import Groq from 'groq-sdk';
import { SpeakingGateway } from './speaking.gateway';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
// Minimal EBML header required by the shared audio signature validator.
const VALID_WEBM_BASE64 = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).toString('base64');

const makeClient = () => {
  const client: any = {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
  };
  return client;
};

const makeRequest = (token?: string, origin?: string): any => ({
  url: token ? `/speaking-ws?token=${token}` : '/speaking-ws',
  headers: origin ? { origin } : {},
});

const connect = async (
  gateway: SpeakingGateway,
  client: any,
  token: string | undefined,
  userId?: string,
  origin?: string,
) => {
  gateway.jwt.verify = jest.fn().mockImplementation(() => ({
    type: 'ACCESS',
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  await gateway.handleConnection(client, makeRequest(token, origin));
};

describe('SpeakingGateway ownership (SEC-02)', () => {
  let gateway: SpeakingGateway;
  let prisma: any;
  let tokens: any;
  let config: any;
  let groq: any;

  beforeEach(() => {
    (Groq as unknown as jest.Mock).mockClear();
    prisma = {
      users: { findFirst: jest.fn().mockResolvedValue({ id: USER_A, is_active: true }) },
      speaking_submissions: { create: jest.fn().mockResolvedValue({ id: 'row' }) },
    };
    tokens = { consumeTokens: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'CORS_ORIGINS') return 'https://app.example.test';
        if (key === 'GROQ_API_KEY') return 'test-key';
        return fallback;
      }),
    };
    gateway = new SpeakingGateway(config, { verify: jest.fn() } as any, prisma, tokens);
    groq = (Groq as unknown as jest.Mock).mock.results[0].value;
    groq.audio.transcriptions.create = jest.fn().mockResolvedValue('hello world');
    groq.chat.completions.create = jest.fn().mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Feedback [SCORES]{"overall":80,"grammar":70,"vocabulary":90}[/SCORES]' } }] };
      })(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects a socket with no JWT before any paid work', async () => {
    const client = makeClient();
    await gateway.handleConnection(client, makeRequest(undefined));

    expect(client._rejected).toBe(true);
    expect(client._userId).toBeUndefined();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
    expect(tokens.consumeTokens).not.toHaveBeenCalled();
    expect(groq.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  it('rejects a JWT whose subject does not resolve to an active user', async () => {
    const client = makeClient();
    prisma.users.findFirst.mockResolvedValue(null);
    await connect(gateway, client, 'token', USER_B);

    expect(client._rejected).toBe(true);
    expect(client._userId).toBeUndefined();
    expect(tokens.consumeTokens).not.toHaveBeenCalled();
  });

  it('never writes a submission for another user when user A sends audio', async () => {
    const client = makeClient();
    await connect(gateway, client, 'token', USER_A);
    gateway.onStartSession(client, { topic: 'travel', level: 'B1', language: 'english' });

    await gateway.onAudioData(client, { audio: VALID_WEBM_BASE64, mimeType: 'audio/webm' });

    expect(tokens.consumeTokens).toHaveBeenCalledWith(
      USER_A, 'speaking_feedback', undefined, expect.stringContaining('speaking-ws-'),
    );
    expect(prisma.speaking_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: USER_A }) }),
    );
    const writtenUser = prisma.speaking_submissions.create.mock.calls[0][0].data.user_id;
    expect(writtenUser).not.toBe(USER_B);
  });

  it('keys token consumption to the connecting user, not to a body-supplied id', async () => {
    const client = makeClient();
    await connect(gateway, client, 'token', USER_B);
    prisma.users.findFirst.mockResolvedValue({ id: USER_B, is_active: true });
    gateway.onStartSession(client, { topic: 'travel', level: 'B1', language: 'english' });

    await gateway.onAudioData(client, {
      audio: VALID_WEBM_BASE64,
      mimeType: 'audio/webm',
      userId: USER_A,
    } as any);

    expect(tokens.consumeTokens.mock.calls[0][0]).toBe(USER_B);
  });

  it('aborts persistence when the token is revoked mid-request', async () => {
    const client = makeClient();
    await connect(gateway, client, 'token', USER_A);
    gateway.onStartSession(client, { topic: 'travel', level: 'B1', language: 'english' });

    // onAudioData re-verifies the token after marking the socket busy.
    gateway.jwt.verify = jest.fn().mockImplementation(() => {
      throw new Error('revoked');
    });

    await gateway.onAudioData(client, { audio: VALID_WEBM_BASE64, mimeType: 'audio/webm' });

    expect(client._rejected).toBe(true);
    expect(groq.audio.transcriptions.create).not.toHaveBeenCalled();
    expect(prisma.speaking_submissions.create).not.toHaveBeenCalled();
  });

  it('does not persist a submission after disconnect aborted the request', async () => {
    const client = makeClient();
    await connect(gateway, client, 'token', USER_A);
    gateway.onStartSession(client, { topic: 'travel', level: 'B1', language: 'english' });

    gateway.handleDisconnect(client);
    await gateway.onAudioData(client, { audio: VALID_WEBM_BASE64, mimeType: 'audio/webm' });

    expect(client._abort.signal.aborted).toBe(true);
    expect(groq.audio.transcriptions.create).not.toHaveBeenCalled();
    expect(prisma.speaking_submissions.create).not.toHaveBeenCalled();
  });

  it('does not start a session on an unauthenticated socket', async () => {
    const client = makeClient();
    await gateway.handleConnection(client, makeRequest(undefined));

    gateway.onStartSession(client, { topic: 'travel', level: 'B1', language: 'english' });

    expect(client._sid).toBeUndefined();
    expect(client.send).not.toHaveBeenCalledWith(expect.stringContaining('session_ready'));
  });
});
