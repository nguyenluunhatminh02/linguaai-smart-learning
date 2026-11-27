-- Merge device_fingerprints into user_devices table

-- Step 1: Add fingerprint column to user_devices
ALTER TABLE "user_devices" ADD COLUMN IF NOT EXISTS "fingerprint" VARCHAR(255);

-- Step 2: Create index on fingerprint for performance
CREATE INDEX IF NOT EXISTS "user_devices_fingerprint_idx" ON "user_devices"("fingerprint");

-- Step 3: Preserve existing fingerprints on their user_devices rows.
-- device_fingerprints.id is unique per record; if a user has several fingerprints,
-- keep the most recently seen one (NULLs last) so the merge is deterministic.
UPDATE "user_devices" ud
SET "fingerprint" = df."fingerprint"
FROM (
  SELECT DISTINCT ON ("user_id")
    "user_id", "fingerprint", "last_seen_at", "created_at"
  FROM "device_fingerprints"
  WHERE "user_id" IS NOT NULL AND "fingerprint" IS NOT NULL
  ORDER BY "user_id", "last_seen_at" DESC NULLS LAST, "created_at" DESC
) df
WHERE ud."user_id" = df."user_id";

-- Step 4: Keep fingerprint rows whose user has no user_devices record. Create a
-- placeholder device row with the old fingerprint so no trust data is discarded.
INSERT INTO "user_devices" ("id", "user_id", "device_id", "fingerprint", "trusted", "last_active_at", "created_at")
SELECT
  uuid_generate_v4(),
  df."user_id",
  'migrated-fingerprint-' || df."id"::text,
  df."fingerprint",
  COALESCE(df."is_trusted", false),
  df."last_seen_at",
  COALESCE(df."created_at", CURRENT_TIMESTAMP)
FROM (
  SELECT DISTINCT ON ("user_id")
    "id", "user_id", "fingerprint", "is_trusted", "last_seen_at", "created_at"
  FROM "device_fingerprints"
  WHERE "user_id" IS NOT NULL AND "fingerprint" IS NOT NULL
  ORDER BY "user_id", "last_seen_at" DESC NULLS LAST, "created_at" DESC
) df
WHERE NOT EXISTS (
  SELECT 1 FROM "user_devices" ud WHERE ud."user_id" = df."user_id"
);

-- Step 5: Drop device_fingerprints after all fingerprint data has been copied.
DROP TABLE IF EXISTS "device_fingerprints" CASCADE;
