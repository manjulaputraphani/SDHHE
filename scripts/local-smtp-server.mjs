/**
 * A tiny SMTP server for the local check (Phase 12).
 *
 * It speaks just enough SMTP to accept one mail and writes it to
 * /tmp/local-smtp-mail.txt — so the worker's Gmail client can be tested
 * without a real mail account.
 *
 *   node scripts/local-smtp-server.mjs
 */
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";

const PORT = Number(process.env.SMTP_TEST_PORT ?? 2525);
const OUT = process.env.SMTP_TEST_OUT ?? "/tmp/local-smtp-mail.txt";

const server = createServer((socket) => {
  let buffer = "";
  let inData = false;
  let mail = "";

  const send = (line) => socket.write(`${line}\r\n`);
  send("220 local.test ESMTP ready");

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\r\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (inData) {
        if (line === ".") {
          inData = false;
          writeFileSync(OUT, mail, "utf8");
          console.log(`MAIL RECEIVED (${mail.length} bytes) -> ${OUT}`);
          mail = "";
          send("250 2.0.0 Ok: queued");
        } else {
          mail += `${line}\n`;
        }
      } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
        send("250-local.test");
        send("250 AUTH LOGIN PLAIN");
      } else if (line.startsWith("AUTH LOGIN")) {
        send("334 VXNlcm5hbWU6");
      } else if (line.startsWith("MAIL FROM")) {
        send("250 2.1.0 Ok");
      } else if (line.startsWith("RCPT TO")) {
        send("250 2.1.5 Ok");
      } else if (line.startsWith("DATA")) {
        inData = true;
        send("354 End data with <CR><LF>.<CR><LF>");
      } else if (line.startsWith("QUIT")) {
        send("221 2.0.0 Bye");
        socket.end();
      } else {
        // The user name / the password (base64) — always accept.
        send("235 2.7.0 Accepted");
      }
      index = buffer.indexOf("\r\n");
    }
  });

  socket.on("error", () => undefined);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`local SMTP server on 127.0.0.1:${PORT} (mail goes to ${OUT})`);
});
