-- Phase 14 — Chat groups
-- An owner-made group can be archived: it disappears from every list but is
-- never hard-deleted (the messages and the members stay in the database).

ALTER TABLE "chat_conversations"
ADD COLUMN "archived_at" timestamp with time zone;
