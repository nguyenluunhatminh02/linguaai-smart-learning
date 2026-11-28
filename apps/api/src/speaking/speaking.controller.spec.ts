// @ts-nocheck
/** SEC-02 regression: HTTP handlers forward the authenticated user id into every service call. */
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { SpeakingController } from './speaking.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const SUBMISSION_ID = '00000000-0000-4000-8000-000000000003';

describe('SpeakingController ownership (SEC-02)', () => {
  let service: any;
  let controller: SpeakingController;

  beforeEach(() => {
    service = {
      transcribe: jest.fn().mockResolvedValue({ transcript: 'hello' }),
      getHistory: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getOne: jest.fn().mockResolvedValue({ id: SUBMISSION_ID }),
    };
    controller = new SpeakingController(service);
  });

  it('declares JwtAuthGuard on the controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SpeakingController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('forwards the caller id into transcribe', async () => {
    await controller.transcribe(OWNER_ID, { audio: 'dGVzdA==', mimeType: 'audio/webm' });
    expect(service.transcribe).toHaveBeenCalledWith(
      OWNER_ID,
      'dGVzdA==',
      'audio/webm',
      undefined,
    );
  });

  it('forwards the caller id into the history query', async () => {
    await controller.getHistory(OWNER_ID, 2, 5);
    expect(service.getHistory).toHaveBeenCalledWith(OWNER_ID, 2, 5);
  });

  it('forwards the caller id into the single-submission lookup', async () => {
    await expect(controller.getOne(OWNER_ID, SUBMISSION_ID)).resolves.toEqual({
      id: SUBMISSION_ID,
    });
    expect(service.getOne).toHaveBeenCalledWith(OWNER_ID, SUBMISSION_ID);
  });
});
