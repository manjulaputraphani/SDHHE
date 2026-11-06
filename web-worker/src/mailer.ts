/**
 * Mail for the Team Chat (Phase 12, T-12.7).
 *
 * The shop's mail goes out through **Gmail SMTP** (the `worker-mailer` way):
 * the Worker opens a TLS socket to smtp.gmail.com and speaks SMTP itself, so
 * there is no third-party mail API in between and no secret ever leaves the
 * Worker. A push notification goes to ntfy at the same time.
 *
 * The SMTP conversation is written against a small transport interface, so it
 * can be tested without a network (see mailer.test.ts).
 */

export interface SmtpTransport {
  /** One chunk from the server. */
  read(): Promise<string>;
  /** Send a line to the server. */
  write(data: string): Promise<void>;
  /** Close the connection. */
  close(): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  /** 465 = implicit TLS (the default), 587 = STARTTLS. */
  port?: number;
  user: string;
  pass: string;
  from: string;
}

export interface MailContent {
  to: string[];
  subject: string;
  html: string;
  date?: Date;
}

export type SmtpResult = { ok: boolean; error?: string };

/** One SMTP response: the code and its lines. */
export function parseSmtpResponse(text: string): { code: number; lines: string[]; ok: boolean } {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { code: 0, lines: [], ok: false };
  const last = lines[lines.length - 1] ?? "";
  const code = Number(last.slice(0, 3));
  return { code: Number.isFinite(code) ? code : 0, lines, ok: code >= 200 && code < 400 };
}

/** The addresses in a "a@b.com, c@d.com" list (the invalid ones are dropped). */
export function parseRecipients(input: string): string[] {
  return input
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

function base64(text: string): string {
  let raw = "";
  for (const byte of new TextEncoder().encode(text)) raw += String.fromCharCode(byte);
  return btoa(raw);
}

/** The whole mail as it goes into the DATA block. */
export function buildMimeMessage(input: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  date?: Date;
}): string {
  const date = (input.date ?? new Date()).toUTCString();
  const body = base64(input.html).replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** One mail: the server to use, the sign-in and the content. */
export interface SmtpSend extends SmtpConfig {
  to: string[];
  subject: string;
  html: string;
  date?: Date;
}

/** How long the mail server may take before we give up (seconds). */
export const SMTP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Speaks SMTP over a transport (a real socket in production). */
export class SmtpSession {
  private buffer = "";

  constructor(private readonly transport: SmtpTransport) {}

  /** Read lines until the server sends a complete response. */
  private async readResponse(): Promise<{ code: number; lines: string[]; ok: boolean }> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const chunk = await withTimeout(
        this.transport.read(),
        SMTP_TIMEOUT_MS,
        "The mail server",
      );
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      // A response is complete when the last line is "NNN text" (not "NNN-text").
      const last = lines[lines.length - 2] ?? "";
      if (/^\d{3}[ ]/.test(last) || (lines.length === 2 && /^\d{3}$/.test(last))) {
        const text = lines.slice(0, -1).join("\r\n");
        this.buffer = "";
        return parseSmtpResponse(text);
      }
    }
    return { code: 0, lines: [], ok: false };
  }

  private async command(line: string): Promise<{ code: number; lines: string[]; ok: boolean }> {
    await this.transport.write(`${line}\r\n`);
    return this.readResponse();
  }

  /** Send one mail. Never throws — the caller decides what to do with it. */
  async send(input: SmtpSend): Promise<SmtpResult> {
    const config: SmtpConfig = {
      host: input.host,
      port: input.port,
      user: input.user,
      pass: input.pass,
      from: input.from,
    };
    const content: MailContent = {
      to: input.to,
      subject: input.subject,
      html: input.html,
      date: input.date,
    };
    try {
      const greeting = await this.readResponse();
      if (!greeting.ok) return { ok: false, error: `The mail server refused the connection (${greeting.code})` };

      const hello = await this.command("EHLO stock-tracker");
      if (!hello.ok) return { ok: false, error: `The mail server did not say hello (${hello.code})` };

      const auth = await this.command("AUTH LOGIN");
      if (!auth.ok) return { ok: false, error: `The mail server refused the sign-in (${auth.code})` };

      const user = await this.command(base64(config.user));
      if (!user.ok) return { ok: false, error: `The mail server refused the user name (${user.code})` };

      const pass = await this.command(base64(config.pass));
      if (!pass.ok) return { ok: false, error: `Wrong password or the app password is not allowed (${pass.code})` };

      const from = await this.command(`MAIL FROM:<${config.from}>`);
      if (!from.ok) return { ok: false, error: `The mail server refused the sender (${from.code})` };

      for (const address of content.to) {
        const rcpt = await this.command(`RCPT TO:<${address}>`);
        if (!rcpt.ok) return { ok: false, error: `The mail server refused ${address} (${rcpt.code})` };
      }

      const data = await this.command("DATA");
      if (!data.ok) return { ok: false, error: `The mail server refused the message (${data.code})` };

      const raw = buildMimeMessage({
        from: config.from,
        to: content.to,
        subject: content.subject,
        html: content.html,
        date: content.date,
      });
      await this.transport.write(`${raw}\r\n.\r\n`);
      const queued = await this.readResponse();
      await this.command("QUIT");
      if (!queued.ok) return { ok: false, error: `The mail server did not take the message (${queued.code})` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await this.transport.close().catch(() => undefined);
    }
  }
}

/**
 * Send one mail through Gmail. Returns false (never throws) when the mail
 * could not be sent — a failed mail must never break the action that caused it.
 */
export async function sendMail(
  config: SmtpConfig,
  content: MailContent,
  makeTransport: (config: SmtpConfig) => Promise<SmtpTransport>,
): Promise<SmtpResult> {
  if (!config.user || !config.pass || !config.from) {
    return { ok: false, error: "The mail is not configured" };
  }
  if (content.to.length === 0) return { ok: false, error: "Nobody to send to" };
  const transport = await withTimeout(
    makeTransport(config),
    SMTP_TIMEOUT_MS,
    "The mail server",
  );
  return new SmtpSession(transport).send({ ...config, ...content });
}

/** A push notification through ntfy (best effort). */
export async function pushNtfy(
  topic: string | undefined,
  title: string,
  message: string,
): Promise<boolean> {
  if (!topic) return false;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, message, tags: ["receipt"] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
