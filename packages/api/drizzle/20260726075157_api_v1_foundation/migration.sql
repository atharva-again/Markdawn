CREATE TABLE "api_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"principal_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"etag" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_records_principal_key_unique" UNIQUE("principal_key","idempotency_key"),
	CONSTRAINT "api_idempotency_records_key_length_check" CHECK (char_length("idempotency_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "api_token_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_id" uuid,
	"owner_id" uuid,
	"page_id" uuid,
	"operation" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "api_tokens_token_hash_unique" UNIQUE,
	"scopes" text[] DEFAULT array['pages:read']::text[] NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_name_length_check" CHECK (char_length("name") <= 100)
);
--> statement-breakpoint
UPDATE "pages"
SET
	"created_at" = coalesce("created_at", "updated_at", now()),
	"updated_at" = coalesce("updated_at", "created_at", now())
WHERE "created_at" IS NULL OR "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "api_idempotency_records_expires_at_idx" ON "api_idempotency_records" ("expires_at");--> statement-breakpoint
CREATE INDEX "api_token_audit_events_created_at_idx" ON "api_token_audit_events" ("created_at");--> statement-breakpoint
CREATE INDEX "api_token_audit_events_token_created_idx" ON "api_token_audit_events" ("token_id","created_at");--> statement-breakpoint
CREATE INDEX "api_token_audit_events_owner_idx" ON "api_token_audit_events" ("owner_id");--> statement-breakpoint
CREATE INDEX "api_token_audit_events_page_idx" ON "api_token_audit_events" ("page_id");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "pages_title_exact_idx" ON "pages" (lower("title"));--> statement-breakpoint
ALTER TABLE "api_token_audit_events" ADD CONSTRAINT "api_token_audit_events_token_id_api_tokens_id_fkey" FOREIGN KEY ("token_id") REFERENCES "api_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "api_token_audit_events" ADD CONSTRAINT "api_token_audit_events_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "api_token_audit_events" ADD CONSTRAINT "api_token_audit_events_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
