-- Phase 12 Team Chat: message history + receipt approvals (additive only).

CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"room" text NOT NULL DEFAULT 'main',
	"user_id" integer REFERENCES "app_users"("id"),
	"author" text NOT NULL,
	"role" text NOT NULL DEFAULT 'staff',
	"kind" text NOT NULL DEFAULT 'text',
	"body" text NOT NULL DEFAULT '',
	"receipt_id" integer,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "chat_messages_kind_valid" CHECK ("kind" in ('text','receipt','system'))
);

CREATE INDEX IF NOT EXISTS "chat_messages_room_id_idx" ON "chat_messages" ("room","id");

CREATE TABLE IF NOT EXISTS "receipt_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitted_by" integer REFERENCES "app_users"("id"),
	"submitter_name" text NOT NULL,
	"title" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"note" text,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"decided_by" integer REFERENCES "app_users"("id"),
	"decider_name" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"message_id" integer REFERENCES "chat_messages"("id"),
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "receipt_requests_status_valid" CHECK ("status" in ('pending','approved','rejected')),
	CONSTRAINT "receipt_requests_amount_positive" CHECK ("amount_paise" > 0)
);

CREATE INDEX IF NOT EXISTS "receipt_requests_status_idx" ON "receipt_requests" ("status","id");
