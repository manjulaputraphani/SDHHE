-- Phase 16 — Chat polish (T-16.4): replies, reactions, pinned messages
-- Additive only — old messages in the DB are never changed.

ALTER TABLE "chat_messages"
ADD COLUMN "reply_to_id" integer REFERENCES "chat_messages" ("id");

CREATE TABLE "chat_reactions" (
  "id" serial PRIMARY KEY,
  "message_id" integer NOT NULL REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "app_users" ("id") ON DELETE CASCADE,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chat_reactions_message_user" UNIQUE ("message_id", "user_id")
);

CREATE INDEX "chat_reactions_message_idx" ON "chat_reactions" ("message_id");

CREATE TABLE "chat_pinned_messages" (
  "id" serial PRIMARY KEY,
  "room" text NOT NULL,
  "message_id" integer NOT NULL UNIQUE REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
  "pinned_by" integer REFERENCES "app_users" ("id"),
  "pinned_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "chat_pinned_room_idx" ON "chat_pinned_messages" ("room");
