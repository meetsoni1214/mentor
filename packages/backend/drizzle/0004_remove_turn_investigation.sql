-- Submission identity now depends only on the message text. Preserve replay of
-- existing request IDs after removing per-message investigation permission.
UPDATE "conversation_turns"
SET "input_digest" = encode(sha256(convert_to("text", 'UTF8')), 'hex');
--> statement-breakpoint
ALTER TABLE "conversation_turns" DROP COLUMN "investigate";
