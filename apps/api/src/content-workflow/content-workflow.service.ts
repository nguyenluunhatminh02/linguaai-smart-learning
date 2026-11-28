import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewStatus } from './dto/content-workflow.dto';

/** Shape of a row in the raw-SQL-only content_submissions table. */
export interface SubmissionRow {
  id: string;
  content_item_id: string;
  author_id: string | null;
  status: ReviewStatus;
  reviewer_id: string | null;
  review_notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Submission joined with the content item it refers to (review queue view). */
export interface SubmissionListItem extends SubmissionRow {
  title: string;
  type: string;
  level: string;
  published: boolean;
}

export interface SubmissionListResult {
  items: SubmissionListItem[];
  limit: number;
  offset: number;
}

type ReviewDecision = 'APPROVED' | 'REJECTED';

/**
 * Teacher/moderator content review workflow.
 *
 * The content_submissions table is intentionally not part of schema.prisma;
 * all access goes through tagged raw queries so no generated client changes
 * are required. Every identifier and value is parameterized by Prisma.
 */
@Injectable()
export class ContentWorkflowService {
  private readonly logger = new Logger(ContentWorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit a content item for review. A resubmission supersedes any prior
   * decision and hides the item until a reviewer approves it again.
   */
  async submit(
    contentItemId: string,
    authorId: string,
  ): Promise<SubmissionRow> {
    const exists = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM content_items WHERE id = ${contentItemId}::uuid
    `;
    if (exists.length === 0) {
      throw new NotFoundException('Content item not found');
    }

    // Both writes share a transaction: a submission must never exist for
    // content that is still publicly visible.
    return this.prisma.$transaction(async (tx) => {
      // The migration intentionally allows multiple submission versions per
      // content item (no unique constraint on content_item_id), so this is a
      // plain insert with the next version computed in the same transaction.
      const rows = await tx.$queryRaw<SubmissionRow[]>`
        INSERT INTO content_submissions (content_item_id, author_id, status, version)
        VALUES (
          ${contentItemId}::uuid,
          ${authorId}::uuid,
          'PENDING',
          COALESCE((SELECT MAX(version) FROM content_submissions
                    WHERE content_item_id = ${contentItemId}::uuid), 0) + 1
        )
        RETURNING id, content_item_id, author_id, status, reviewer_id,
                  review_notes, version, created_at, updated_at
      `;

      await tx.$executeRaw`
        UPDATE content_items
        SET published = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${contentItemId}::uuid
      `;

      return rows[0];
    });
  }

  /** List submissions oldest-first so reviewers work the queue fairly. */
  async list(
    status?: ReviewStatus,
    limit = 20,
    offset = 0,
  ): Promise<SubmissionListResult> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    const safeOffset = Math.max(Math.trunc(offset) || 0, 0);

    const rows = await this.prisma.$queryRaw<SubmissionListItem[]>`
      SELECT s.id, s.content_item_id, s.author_id, s.status, s.reviewer_id,
             s.review_notes, s.version, s.created_at, s.updated_at,
             c.title, c.type, c.level, c.published
      FROM content_submissions s
      JOIN content_items c ON c.id = s.content_item_id
      WHERE (${status === undefined}::boolean OR s.status = ${status ?? null})
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    return { items: rows, limit: safeLimit, offset: safeOffset };
  }

  async getById(id: string): Promise<SubmissionListItem> {
    const rows = await this.prisma.$queryRaw<SubmissionListItem[]>`
      SELECT s.id, s.content_item_id, s.author_id, s.status, s.reviewer_id,
             s.review_notes, s.version, s.created_at, s.updated_at,
             c.title, c.type, c.level, c.published
      FROM content_submissions s
      JOIN content_items c ON c.id = s.content_item_id
      WHERE s.id = ${id}::uuid
    `;
    const submission = rows[0];
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    return submission;
  }

  /**
   * Approve or reject a pending submission. The status/version guard makes
   * concurrent or stale reviews fail with 409 instead of double-publishing.
   */
  async review(
    id: string,
    reviewerId: string,
    decision: ReviewDecision,
    reviewNotes?: string,
    expectedVersion?: number,
  ): Promise<SubmissionRow> {
    const notes = reviewNotes?.trim() || null;
    if (decision === 'REJECTED' && !notes) {
      throw new BadRequestException(
        'Review notes are required when rejecting content',
      );
    }

    // The UPDATE + publish flip must be atomic; otherwise a crash between the
    // two statements would leave the decision and item visibility out of sync.
    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<SubmissionRow[]>`
        UPDATE content_submissions
        SET status = ${decision},
            reviewer_id = ${reviewerId}::uuid,
            review_notes = ${notes},
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND status = 'PENDING'
          AND (${expectedVersion === undefined}::boolean OR version = ${expectedVersion ?? 0})
        RETURNING id, content_item_id, author_id, status, reviewer_id,
                  review_notes, version, created_at, updated_at
      `;
      const submission = rows[0];
      if (!submission) return null;

      await tx.$executeRaw`
        UPDATE content_items
        SET published = ${decision === 'APPROVED'}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${submission.content_item_id}::uuid
      `;
      return submission;
    });

    if (!updated) {
      const existing = await this.prisma.$queryRaw<
        Array<{ status: ReviewStatus }>
      >`
        SELECT status FROM content_submissions WHERE id = ${id}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundException('Submission not found');
      }
      throw new ConflictException(
        'Submission was already reviewed or its version changed',
      );
    }

    this.logger.log(
      `Content submission ${id} ${decision.toLowerCase()} by ${reviewerId}`,
    );
    return updated;
  }

  approve(
    id: string,
    reviewerId: string,
    reviewNotes?: string,
    expectedVersion?: number,
  ): Promise<SubmissionRow> {
    return this.review(
      id,
      reviewerId,
      'APPROVED',
      reviewNotes,
      expectedVersion,
    );
  }

  reject(
    id: string,
    reviewerId: string,
    reviewNotes: string,
    expectedVersion?: number,
  ): Promise<SubmissionRow> {
    return this.review(
      id,
      reviewerId,
      'REJECTED',
      reviewNotes,
      expectedVersion,
    );
  }
}
