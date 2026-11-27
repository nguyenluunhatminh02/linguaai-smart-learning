-- Move legacy MFA data from users into mfa_secrets before dropping the old
-- columns. Users with two_factor_enabled=true would otherwise be permanently
-- locked out: AuthService still requires MFA but no secret row would remain.
--
-- Legacy backup codes were plain text; mfa_secrets stores SHA-256 hex digests
-- as a JSON array (see MfaService.hashBackupCode / generateRawBackupCodes).
-- encode(digest(code, 'sha256'), 'hex') produces the same digest string since
-- the legacy codes are ASCII, which is what verifyCodeOrBackup compares.
INSERT INTO "mfa_secrets" ("user_id", "secret_encrypted", "enabled", "backup_codes", "verified", "verified_at")
SELECT
    u."id",
    u."two_factor_secret",
    TRUE,
    CASE
        WHEN u."mfa_backup_codes" IS NULL OR cardinality(u."mfa_backup_codes") = 0 THEN NULL
        ELSE '[' || array_to_string(
            ARRAY(
                SELECT '"' || encode(digest(trim(code), 'sha256'), 'hex') || '"'
                FROM unnest(u."mfa_backup_codes") AS code
                WHERE trim(code) <> ''
            ), ','
        ) || ']'
    END,
    TRUE,
    COALESCE(u."updated_at", NOW())
FROM "users" u
WHERE u."two_factor_enabled" = TRUE
  AND NULLIF(btrim(u."two_factor_secret"), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "mfa_secrets" m WHERE m."user_id" = u."id")
ON CONFLICT ("user_id") DO NOTHING;

-- Drop legacy MFA columns from users table (moved to mfa_secrets table)
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_factor_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_backup_codes";
