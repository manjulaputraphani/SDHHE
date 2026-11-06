-- Phase 14: delivery and read marks of a chat message (additive only).

CREATE TABLE IF NOT EXISTS "chat_message_states" (
	"message_id" integer NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "chat_message_states_pkey" PRIMARY KEY ("message_id","user_id")
);

CREATE INDEX IF NOT EXISTS "chat_message_states_user_idx" ON "chat_message_states" ("user_id");
