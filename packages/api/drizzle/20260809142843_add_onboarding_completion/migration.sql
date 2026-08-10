ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp;
--> statement-breakpoint
UPDATE "users"
SET "onboarding_completed_at" = NOW()
WHERE "onboarding_completed_at" IS NULL;
