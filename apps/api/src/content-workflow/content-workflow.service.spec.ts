import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ContentWorkflowService,
  SubmissionRow,
} from './content-workflow.service';

const SUBMISSION_ID = '00000000-0000-4000-8000-000000000020';
const CONTENT_ID = '00000000-0000-4000-8000-000000000010';
const AUTHOR_ID = '00000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000002';

const baseRow: SubmissionRow = {
  id: SUBMISSION_ID,
  content_item_id: CONTENT_ID,
  author_id: AUTHOR_ID,
  status: 'PENDING',
  reviewer_id: null,
  review_notes: null,
  version: 1,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

describe('ContentWorkflowService', () => {
  let queryRaw: jest.Mock;
  let executeRaw: jest.Mock;
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let prisma: any;
  let service: ContentWorkflowService;

  beforeEach(() => {
    queryRaw = jest.fn();
    executeRaw = jest.fn();
    tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    prisma = {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    service = new ContentWorkflowService(prisma);
  });

  it('lists pending submissions oldest-first with a bounded limit', async () => {
    queryRaw.mockResolvedValue([
      {
        ...baseRow,
        title: 'A1 reading',
        type: 'reading',
        level: 'A1',
        published: false,
      },
    ]);

    await expect(service.list('PENDING', 500, -3)).resolves.toEqual({
      items: [
        {
          ...baseRow,
          title: 'A1 reading',
          type: 'reading',
          level: 'A1',
          published: false,
        },
      ],
      limit: 100,
      offset: 0,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when submitting content that does not exist', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(service.submit(CONTENT_ID, AUTHOR_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('appends a new submission version and unpublishes the item when submitted', async () => {
    queryRaw.mockResolvedValue([{ id: CONTENT_ID }]);
    tx.$queryRaw.mockResolvedValue([{ ...baseRow }]);
    tx.$executeRaw.mockResolvedValue(1);

    await expect(service.submit(CONTENT_ID, AUTHOR_ID)).resolves.toEqual(
      baseRow,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('requires review notes when rejecting', async () => {
    await expect(
      service.reject(SUBMISSION_ID, REVIEWER_ID, '  '),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes the item only after approval', async () => {
    const approved: SubmissionRow = {
      ...baseRow,
      status: 'APPROVED',
      reviewer_id: REVIEWER_ID,
      version: 2,
      review_notes: 'Good',
    };
    tx.$queryRaw.mockResolvedValue([approved]);
    tx.$executeRaw.mockResolvedValue(1);

    await expect(
      service.approve(SUBMISSION_ID, REVIEWER_ID, 'Good', 1),
    ).resolves.toEqual(approved);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('returns 409 when the submission is no longer PENDING or its version changed', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    queryRaw.mockResolvedValue([{ status: 'APPROVED' }]);

    await expect(
      service.approve(SUBMISSION_ID, REVIEWER_ID, undefined, 1),
    ).rejects.toThrow(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('returns 404 when reviewing a submission that does not exist', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);

    await expect(service.approve(SUBMISSION_ID, REVIEWER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns 404 from getById when the submission is missing', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(service.getById(SUBMISSION_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
