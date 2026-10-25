ALTER TABLE "conversation_attempts" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "conversation_attempts" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
UPDATE "conversation_attempts"
SET "input_tokens" = ("usage" ->> 'inputTokens')::integer,
    "output_tokens" = ("usage" ->> 'outputTokens')::integer;
--> statement-breakpoint
ALTER TABLE "conversation_attempts" DROP COLUMN "usage";--> statement-breakpoint
ALTER TABLE "conversation_attempts" ADD CONSTRAINT "conversation_attempt_input_tokens_nonnegative" CHECK ("conversation_attempts"."input_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "conversation_attempts" ADD CONSTRAINT "conversation_attempt_output_tokens_nonnegative" CHECK ("conversation_attempts"."output_tokens" >= 0);
