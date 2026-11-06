-- Phase 17 — Message editing (Team Chat) — make editedAt not null and default to now
-- First, set existing rows to have editedAt = createdAt (so they appear as never edited)
UPDATE "chat_messages" SET "edited_at" = "created_at";

-- Then, alter the column to be not null and set a default of now()
ALTER TABLE "chat_messages" 
ALTER COLUMN "edited_at" SET NOT NULL,
ALTER COLUMN "edited_at" SET DEFAULT now();