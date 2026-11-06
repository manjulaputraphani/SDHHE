-- Phase 13 direct chat: conversations + who has read what (additive only).

CREATE TABLE IF NOT EXISTS "chat_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"room" text NOT NULL,
	"kind" text NOT NULL DEFAULT 'direct',
	"title" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "chat_conversations_kind_valid" CHECK ("kind" in ('group','direct'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_room_unique" ON "chat_conversations" ("room");

CREATE TABLE IF NOT EXISTS "chat_conversation_members" (
	"conversation_id" integer NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"last_read_message_id" integer NOT NULL DEFAULT 0,
	"last_read_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "chat_conversation_members_pkey" PRIMARY KEY ("conversation_id","user_id")
);
