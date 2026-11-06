-- Phase 15 fix: a per-member switch for the "Welcome back" banner (additive).

ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "show_welcome_banner" boolean NOT NULL DEFAULT true;
