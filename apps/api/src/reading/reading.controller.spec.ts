// @ts-nocheck
/**
 * SEC-02 regression: the HTTP layer must forward the authenticated user id
 * into the owner-scoped reading service lookup. A controller that drops it
 * would silently undo the repository fix.
 */
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ReadingController } from './reading.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const PASSAGE_ID = '00000000-0000-4000-8000-000000000003';

describe('ReadingController ownership (SEC-02)', () => {
  let readingService: any;
  let tokensService: any;
  let controller: ReadingController;

  beforeEach(() => {
    readingService = {
      getById: jest.fn(),
      getHistory: jest.fn(),
      generate: jest.fn(),
      analyzeText: jest.fn(),
      getRecommendations: jest.fn(),
    };
    tokensService = { consumeTokens: jest.fn().mockResolvedValue(undefined) };
    controller = new ReadingController(readingService, tokensService);
  });

  it('declares JwtAuthGuard on the controller', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, ReadingController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('forwards the caller id and passage id to an owner-scoped lookup', async () => {
    const passage = { id: PASSAGE_ID, generated_by_user_id: OWNER_ID };
    readingService.getById.mockResolvedValue(passage);

    // Call the handler directly with the arguments Nest would inject after
    // resolving @CurrentUser('id') and @Param('id', ParseUUIDPipe).
    await expect(controller.getById(OWNER_ID, PASSAGE_ID)).resolves.toBe(
      passage,
    );
    expect(readingService.getById).toHaveBeenCalledWith(OWNER_ID, PASSAGE_ID);
  });

  it('surfaces the service 404 for a foreign passage instead of returning its body', async () => {
    readingService.getById.mockRejectedValue(
      new NotFoundException('Reading passage not found'),
    );

    await expect(controller.getById(OWNER_ID, PASSAGE_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getById signature takes two arguments (userId, id)', () => {
    expect(controller.getById.length).toBe(2);
  });
});
