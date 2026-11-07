-- Phase 16 — Chat polish (T-16.2): message actions (edit + delete)
-- A deleted message is soft-deleted: the body stays in the database, the
-- bubble shows "This message was deleted". Every edit keeps its previous
-- version in chat_message_edits (audit — old messages are never overwritten
-- without a record).

ALTER TABLE "chat_messages"
ADD COLUMN "deleted_at" timestamp with time zone;

CREATE TABLE "chat_message_edits" (
  "id" serial PRIMARY KEY,
  "message_id" integer NOT NULL REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
  "old_body" text NOT NULL,
  "edited_by" integer REFERENCES "app_users" ("id"),
  "edited_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "chat_message_edits_message_idx" ON "chat_message_edits" ("message_id");
