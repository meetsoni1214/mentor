ALTER TABLE "memories" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "source_request" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "context_start_sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "last_mutation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "forgotten_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversation_context_start_positive" CHECK ("conversations"."context_start_sequence" > 0);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memory_revision_positive" CHECK ("memories"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memory_content_state" CHECK (("memories"."forgotten_at" is null and "memories"."text" is not null and "memories"."source_request" is not null) or ("memories"."forgotten_at" is not null and "memories"."text" is null and "memories"."source_request" is null));
--> statement-breakpoint
UPDATE "conversations" SET "context_start_sequence" = "next_sequence"
WHERE EXISTS (SELECT 1 FROM "memories" WHERE "memories"."owner_id" = "conversations"."owner_id");
