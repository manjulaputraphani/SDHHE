import { eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { settings } from "./schema";
import type { OllamaMode } from "../ai/ollama";

export type ShopDetails = {
  name: string;
  shortName: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  bankBranch: string;
};

export const DEFAULT_SHOP: ShopDetails = {
  name: "",
  shortName: "",
  address: "",
  phone: "",
  email: "",
  gstin: "",
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  bankBranch: "",
};

const SHOP_KEYS = [
  "shop_name",
  "shop_short_name",
  "shop_address",
  "shop_phone",
  "shop_email",
  "shop_gstin",
  "shop_bank_name",
  "shop_bank_account",
  "shop_bank_ifsc",
  "shop_bank_branch",
] as const;

/** Shop header printed on GST bills (Settings → Shop details). */
export async function getShopDetails(db: Db): Promise<ShopDetails> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...SHOP_KEYS]));
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    name: map.get("shop_name") ?? DEFAULT_SHOP.name,
    shortName: map.get("shop_short_name") ?? DEFAULT_SHOP.shortName,
    address: map.get("shop_address") ?? DEFAULT_SHOP.address,
    phone: map.get("shop_phone") ?? DEFAULT_SHOP.phone,
    email: map.get("shop_email") ?? DEFAULT_SHOP.email,
    gstin: map.get("shop_gstin") ?? DEFAULT_SHOP.gstin,
    bankName: map.get("shop_bank_name") ?? DEFAULT_SHOP.bankName,
    bankAccount: map.get("shop_bank_account") ?? DEFAULT_SHOP.bankAccount,
    bankIfsc: map.get("shop_bank_ifsc") ?? DEFAULT_SHOP.bankIfsc,
    bankBranch: map.get("shop_bank_branch") ?? DEFAULT_SHOP.bankBranch,
  };
}

export async function saveShopDetails(db: Db, shop: ShopDetails): Promise<void> {  const pairs: [string, string][] = [
    [SHOP_KEYS[0], shop.name.trim()],
    [SHOP_KEYS[1], shop.shortName.trim().toUpperCase()],
    [SHOP_KEYS[2], shop.address.trim()],
    [SHOP_KEYS[3], shop.phone.trim()],
    [SHOP_KEYS[4], shop.email.trim()],
    [SHOP_KEYS[5], shop.gstin.trim().toUpperCase()],
    [SHOP_KEYS[6], shop.bankName.trim()],
    [SHOP_KEYS[7], shop.bankAccount.trim()],
    [SHOP_KEYS[8], shop.bankIfsc.trim().toUpperCase()],
    [SHOP_KEYS[9], shop.bankBranch.trim()],
  ];
  for (const [key, value] of pairs) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}

export type AiConfig = {
  enabled: boolean;
  mode: OllamaMode;
  model: string;
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  mode: "local",
  model: "glm-5.3-flash:cloud",
};

const KEYS = ["ai_enabled", "ai_mode", "ai_model"] as const;

export async function getAiConfig(db: Db): Promise<AiConfig> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...KEYS]));

  const map = new Map(rows.map((row) => [row.key, row.value]));
  const mode = map.get("ai_mode");
  return {
    enabled: map.get("ai_enabled") === "1",
    mode: mode === "cloud" ? "cloud" : "local",
    model: map.get("ai_model") || DEFAULT_AI_CONFIG.model,
  };
}

export async function saveAiConfig(db: Db, config: AiConfig): Promise<void> {
  const rows = [
    { key: "ai_enabled", value: config.enabled ? "1" : "0" },
    { key: "ai_mode", value: config.mode },
    { key: "ai_model", value: config.model },
  ];
  for (const row of rows) {
    await db
      .insert(settings)
      .values(row)
      .onConflictDoUpdate({ target: settings.key, set: { value: row.value } });
  }
}

export type EmailSettings = {
  fromEmail: string;
  fromName: string;
  host: string;
  port: string;
};

export const DEFAULT_EMAIL: EmailSettings = {
  fromEmail: "",
  fromName: "",
  host: "smtp.gmail.com",
  port: "465",
};

const EMAIL_KEYS = ["smtp_from_email", "smtp_from_name", "smtp_host", "smtp_port"] as const;

/** SMTP sender settings (the app password lives in the Keychain, not here). */
export async function getEmailSettings(db: Db): Promise<EmailSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...EMAIL_KEYS]));
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    fromEmail: map.get("smtp_from_email") ?? DEFAULT_EMAIL.fromEmail,
    fromName: map.get("smtp_from_name") ?? DEFAULT_EMAIL.fromName,
    host: map.get("smtp_host") ?? DEFAULT_EMAIL.host,
    port: map.get("smtp_port") ?? DEFAULT_EMAIL.port,
  };
}

export async function saveEmailSettings(db: Db, email: EmailSettings): Promise<void> {
  const pairs: [string, string][] = [
    [EMAIL_KEYS[0], email.fromEmail.trim()],
    [EMAIL_KEYS[1], email.fromName.trim()],
    [EMAIL_KEYS[2], email.host.trim()],
    [EMAIL_KEYS[3], email.port.trim()],
  ];
  for (const [key, value] of pairs) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}

/**
 * The Team Chat worker address (Phase 12).
 *
 * The chat lives in the Cloudflare Worker (live room, receipt files, mail),
 * so the desktop app needs to know where it is. It is an address, not a
 * secret — the bearer token stays in the Keychain.
 */
const CHAT_WORKER_KEY = "chat_worker_url";

export async function getChatWorkerUrl(db: Db): Promise<string> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.key, CHAT_WORKER_KEY));
  return rows[0]?.value ?? "";
}

export async function saveChatWorkerUrl(db: Db, url: string): Promise<void> {
  const value = url.trim().replace(/\/+$/, "");
  if (!value) {
    await db.delete(settings).where(eq(settings.key, CHAT_WORKER_KEY));
    return;
  }
  await db
    .insert(settings)
    .values({ key: CHAT_WORKER_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
