ALTER TABLE "accounts" ADD COLUMN "issuer" text;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE "provider_id" NOT IN ('credential', 'github', 'google')
  ) THEN
    RAISE EXCEPTION 'Cannot backfill Better Auth account issuers for an unknown provider';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "accounts"
    WHERE "provider_id" IN ('credential', 'github', 'google')
    GROUP BY "provider_id", "account_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create Better Auth account identity index because duplicate provider account identities exist';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "accounts"
SET "issuer" = CASE "provider_id"
  WHEN 'credential' THEN 'local:credential'
  WHEN 'github' THEN 'local:oauth:github'
  WHEN 'google' THEN 'https://accounts.google.com'
END
WHERE "issuer" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "accounts" WHERE "issuer" IS NULL) THEN
    RAISE EXCEPTION 'Cannot complete Better Auth account issuer backfill';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_id_unique" ON "accounts" USING btree ("issuer", "account_id");
