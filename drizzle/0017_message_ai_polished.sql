-- Phase 15 — AI polish (Team Chat)
-- A message that was sent through the polish preview carries a flag, so the
-- bubble can show a tiny spark and the team knows the AI rewrote it.

ALTER TABLE "chat_messages"
ADD COLUMN "ai_polished" boolean NOT NULL DEFAULT false;
