import { invoke } from "@tauri-apps/api/core";

/** Keychain entry keys. Keep in sync with the Rust `save_secret`/`get_secret` callers. */
export const SECRET_KEYS = {
  DATABASE_URL: "DATABASE_URL",
  PIN_HASH: "PIN_HASH",
  OLLAMA_API_KEY: "OLLAMA_API_KEY",
  SMTP_PASSWORD: "SMTP_PASSWORD",
  /** The Team Chat bearer token (Phase 12) — fetched when the member signs in. */
  CHAT_TOKEN: "CHAT_TOKEN",
} as const;

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];

/** Save a secret in the OS keychain. */
export async function saveSecret(key: SecretKey, value: string): Promise<void> {
  await invoke("save_secret", { key, value });
}

/** Read a secret, or null when nothing has been saved yet. */
export async function getSecret(key: SecretKey): Promise<string | null> {
  const value = await invoke<string | null>("get_secret", { key });
  return value ?? null;
}

/** Delete a secret. Deleting a missing key is not an error. */
export async function deleteSecret(key: SecretKey): Promise<void> {
  await invoke("delete_secret", { key });
}

/** argon2id hash of the PIN (random salt), safe to store. */
export async function hashPin(pin: string): Promise<string> {
  return invoke<string>("hash_pin", { pin });
}

/** Constant-time check of a PIN against a stored hash. */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return invoke<boolean>("verify_pin", { pin, hash });
}

/** argon2id hash of a member password (L2, docs/PLAN_LOGIN.md). */
export async function hashPassword(password: string): Promise<string> {
  return invoke<string>("hash_password", { password });
}

/** Constant-time check of a member password against a stored hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return invoke<boolean>("verify_password", { password, hash });
}
