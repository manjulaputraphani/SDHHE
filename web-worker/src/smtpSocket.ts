/**
 * The SMTP over TLS transport (Cloudflare sockets).
 *
 * It lives in its own module so the mailer itself can be tested without the
 * Workers runtime (`cloudflare:sockets` only exists inside a Worker).
 */
import { connect } from "cloudflare:sockets";
import type { SmtpConfig, SmtpTransport } from "./mailer";

export async function socketTransport(config: SmtpConfig): Promise<SmtpTransport> {
  const port = config.port ?? 465;
  // `secureTransport` is a string at runtime: "on" = implicit TLS (port 465),
  // "off" = a plain connection (used by the local check).
  const socket = connect(
    { hostname: config.host, port },
    { secureTransport: port === 465 ? "on" : "off", allowHalfOpen: false } as SocketOptions,
  );
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  return {
    async read() {
      const { value, done } = await reader.read();
      if (done) return "";
      return decoder.decode(value, { stream: true });
    },
    async write(data) {
      await writer.write(new TextEncoder().encode(data));
    },
    async close() {
      await writer.close().catch(() => undefined);
      reader.releaseLock();
    },
  };
}
