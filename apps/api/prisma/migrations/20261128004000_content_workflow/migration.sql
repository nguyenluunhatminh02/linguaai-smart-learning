-- CONTENT-WF-01: teacher content-review queue.
-- Raw-SQL-only table: no schema.prisma model is added, so status is a plain
-- VARCHAR rather than a native PostgreSQL enum. Application-owned values:
-- PENDING (default), APPROVED, REJECTED. uuid-ossp is installed in
-- 20250101000000_baseline_init; TIMESTAMP(6) defaults match all prior migrations.
-- No CHECK constraint: Prisma cannot express one for a model-less table and the
-- review status vocabulary may evolve without another migration.

-- CreateTable
CREATE TABLE IF NOT EXISTS "content_submissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "content_item_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reviewer_id" UUID,
    "review_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "content_submissions_content_item_id_fkey"
        FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "content_submissions_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "content_submissions_reviewer_id_fkey"
        FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

-- Teacher queue: status filter + oldest-first ordering.
CREATE INDEX IF NOT EXISTS "content_submissions_status_created_at_idx"
    ON "content_submissions"("status", "created_at");

-- Latest-version lookup for a content item; intentionally non-unique so a
-- resubmission can create a new version row.
CREATE INDEX IF NOT EXISTS "content_submissions_content_item_id_version_idx"
    ON "content_submissions"("content_item_id", "version");

CREATE INDEX IF NOT EXISTS "content_submissions_author_id_idx"
    ON "content_submissions"("author_id");
CREATE INDEX IF NOT EXISTS "content_submissions_reviewer_id_idx"
    ON "content_submissions"("reviewer_id");
