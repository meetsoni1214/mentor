CREATE TABLE "assistant_daily_admissions" (
	"owner_id" uuid NOT NULL,
	"day" date NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "assistant_daily_admissions_owner_id_day_pk" PRIMARY KEY("owner_id","day"),
	CONSTRAINT "assistant_admissions_positive" CHECK ("assistant_daily_admissions"."attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "assistant_disclosure_acknowledgements" (
	"owner_id" uuid NOT NULL,
	"version" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_disclosure_acknowledgements_owner_id_version_pk" PRIMARY KEY("owner_id","version")
);
--> statement-breakpoint
CREATE TABLE "conversation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"model" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"answer" text,
	"error_code" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"context_limited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_attempt_request_unique" UNIQUE("conversation_id","request_id"),
	CONSTRAINT "conversation_attempt_number_unique" UNIQUE("turn_id","attempt_number"),
	CONSTRAINT "conversation_attempt_number_positive" CHECK ("conversation_attempts"."attempt_number" > 0),
	CONSTRAINT "conversation_attempt_state_valid" CHECK ("conversation_attempts"."state" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "conversation_attempt_deadline_valid" CHECK ("conversation_attempts"."deadline_at" > "conversation_attempts"."started_at"),
	CONSTRAINT "conversation_attempt_outcome_valid" CHECK ((
      ("conversation_attempts"."state" = 'running' and "conversation_attempts"."finished_at" is null and "conversation_attempts"."answer" is null and "conversation_attempts"."error_code" is null)
      or ("conversation_attempts"."state" = 'completed' and "conversation_attempts"."finished_at" is not null and "conversation_attempts"."answer" is not null and "conversation_attempts"."error_code" is null)
      or ("conversation_attempts"."state" in ('failed', 'interrupted') and "conversation_attempts"."finished_at" is not null and "conversation_attempts"."answer" is null and "conversation_attempts"."error_code" is not null)
    ))
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_digest" text NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"investigate" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turn_request_unique" UNIQUE("conversation_id","request_id"),
	CONSTRAINT "conversation_turn_sequence_unique" UNIQUE("conversation_id","sequence"),
	CONSTRAINT "conversation_turn_id_conversation_unique" UNIQUE("id","conversation_id"),
	CONSTRAINT "conversation_turn_sequence_positive" CHECK ("conversation_turns"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"history_version" integer DEFAULT 0 NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "conversation_version_nonnegative" CHECK ("conversations"."history_version" >= 0),
	CONSTRAINT "conversation_sequence_positive" CHECK ("conversations"."next_sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_daily_admissions" ADD CONSTRAINT "assistant_daily_admissions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_disclosure_acknowledgements" ADD CONSTRAINT "assistant_disclosure_acknowledgements_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attempts" ADD CONSTRAINT "conversation_attempts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attempts" ADD CONSTRAINT "conversation_attempt_turn_fk" FOREIGN KEY ("turn_id","conversation_id") REFERENCES "public"."conversation_turns"("id","conversation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_one_running_attempt" ON "conversation_attempts" USING btree ("conversation_id") WHERE "conversation_attempts"."state" = 'running';--> statement-breakpoint
CREATE INDEX "conversation_attempt_turn_idx" ON "conversation_attempts" USING btree ("turn_id");