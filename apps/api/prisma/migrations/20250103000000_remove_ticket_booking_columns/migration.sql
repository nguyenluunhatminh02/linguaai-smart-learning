-- Drop ticket-booking legacy columns
ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_order_enabled";
ALTER TABLE "users" DROP COLUMN IF EXISTS "notification_promotion_enabled";