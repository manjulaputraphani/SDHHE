-- Phase 15: the in-app notification system (banners, toasts, releases, tours,
-- login history and the one-device rule). Additive only.

-- 1. announcements (the full-width bar on every page)
CREATE TABLE IF NOT EXISTS "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"kind" text NOT NULL DEFAULT 'info',
	"link_label" text,
	"link_url" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_by" integer REFERENCES "app_users"("id"),
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "announcements_kind_valid" CHECK ("kind" in ('info','success','warning','critical'))
);

-- a member dismisses an announcement for good (on every device)
CREATE TABLE IF NOT EXISTS "announcement_dismissals" (
	"announcement_id" integer NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"dismissed_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("announcement_id","user_id")
);

-- 2. releases ("what's new")
CREATE TABLE IF NOT EXISTS "releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"items" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"image_url" text,
	"release_date" timestamp with time zone NOT NULL DEFAULT now(),
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_releases_seen" (
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"release_id" integer NOT NULL REFERENCES "releases"("id") ON DELETE CASCADE,
	"seen_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "user_releases_seen_pkey" PRIMARY KEY ("user_id","release_id")
);

-- 3. the product tours
CREATE TABLE IF NOT EXISTS "user_tours" (
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"tour_id" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "user_tours_pkey" PRIMARY KEY ("user_id","tour_id")
);

-- 4. every sign-in (and the one-device rule)
CREATE TABLE IF NOT EXISTS "login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "app_users"("id") ON DELETE CASCADE,
	"device" text,
	"browser" text,
	"os" text,
	"ip" text,
	"session_id" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "login_history_user_idx" ON "login_history" ("user_id","created_at" DESC);

-- 5. the members get a few extra columns
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean NOT NULL DEFAULT false;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "last_seen_release" integer;
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;

-- 6. the sessions know their device (one device at a time)
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "session_id" text;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "device" text;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "browser" text;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "os" text;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "ip" text;
ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "forced_out" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "user_sessions_session_id_idx" ON "user_sessions" ("session_id");
