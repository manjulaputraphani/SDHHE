-- Phase 18 (mobile): Expo push tokens for the SDHHE Mobile Android app.
-- The browser Web Push stack (push_subscriptions) cannot reach a React
-- Native binary; the native app registers an Expo push token instead and
-- the worker fans chat notifications out through the Expo Push API.

CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "push_tokens_user_idx" ON "push_tokens" ("user_id");
