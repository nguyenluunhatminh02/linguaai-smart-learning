-- Clean up notifications_type_enum: remove e-commerce (ORDER, PROMOTION)
-- and channel-overlapping values (PUSH, EMAIL, IN_APP)
-- Keep only: SYSTEM, SECURITY, ACCOUNT

-- 1. Create new enum type with desired values
CREATE TYPE "notifications_type_enum_new" AS ENUM ('SYSTEM', 'SECURITY', 'ACCOUNT');

-- 2. Map legacy type values that are not in the new enum to 'SYSTEM' BEFORE
--    the ALTER. Without this step, any row whose type is ORDER, PROMOTION,
--    PUSH, EMAIL, or IN_APP causes the ALTER to abort with
--    "invalid input value for enum", leaving the database in a partially
--    migrated state and blocking `prisma migrate deploy` (and therefore the
--    API container startup, which runs migrate deploy before the app).
--    SYSTEM is the safest generic target: it preserves the row, keeps the
--    notification visible to admins, and does not collide with the
--    notifications_channel_enum (which still carries EMAIL/PUSH/IN_APP for
--    the delivery channel, independent of the notification type).
UPDATE "notifications"
  SET "type" = 'SYSTEM'
  WHERE "type"::text IN ('ORDER', 'PROMOTION', 'PUSH', 'EMAIL', 'IN_APP');

-- 3. Alter notifications table column to use new type
ALTER TABLE "notifications"
  ALTER COLUMN "type" TYPE "notifications_type_enum_new"
  USING "type"::text::"notifications_type_enum_new";

-- 4. Drop old enum type
DROP TYPE "notifications_type_enum";

-- 5. Rename new enum type to original name
ALTER TYPE "notifications_type_enum_new" RENAME TO "notifications_type_enum";
