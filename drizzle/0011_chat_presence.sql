-- Phase 1: presence + read receipts (additive).

ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

-- the read receipts already live in chat_message_states (delivered_at, read_at);
-- these indexes make the "who read it" lookup fast.
CREATE INDEX IF NOT EXISTS "chat_message_states_message_idx" ON "chat_message_states" ("message_id");
CREATE INDEX IF NOT EXISTS "chat_messages_room_id_idx2" ON "chat_messages" ("room", "id" DESC);
