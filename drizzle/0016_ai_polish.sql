-- Phase 15 — AI polish (Team Chat)
-- The owner turns AI polish on per group; in those groups a message is
-- rewritten professionally before sending — as a suggestion the sender
-- confirms. Additive and safe.

ALTER TABLE "chat_conversations"
ADD COLUMN "ai_polish" boolean NOT NULL DEFAULT false;
