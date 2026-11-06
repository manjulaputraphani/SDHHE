-- Phase 17 — Message editing (Team Chat)
-- Add support for editing text messages

ALTER TABLE "chat_messages" 
ADD COLUMN "edited_at" timestamp with time zone;

-- Optional: Add index for querying edited messages if needed
-- CREATE INDEX IF NOT EXISTS "chat_messages_edited_at_idx" ON "chat_messages" ("edited_at");