CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source_request" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_owner_request_unique" UNIQUE("owner_id","request_id"),
	CONSTRAINT "memory_text_bound" CHECK (octet_length("memories"."text") between 1 and 512),
	CONSTRAINT "memory_source_request_bound" CHECK (octet_length("memories"."source_request") between 1 and 1024)
);
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;