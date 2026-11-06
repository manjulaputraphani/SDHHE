import { describe, expect, it } from "vitest";
import {
  SmtpSession,
  buildMimeMessage,
  parseRecipients,
  parseSmtpResponse,
  type SmtpTransport,
} from "./mailer";

/** A scripted SMTP server: every read returns the next line of the script. */
function fakeServer(lines: string[]): SmtpTransport & { sent: string[] } {
  const sent: string[] = [];
  let index = 0;
  return {
    sent,
    async read() {
      const line = lines[index] ?? "";
      index += 1;
      return `${line}\r\n`;
    },
    async write(data: string) {
      sent.push(data);
    },
    async close() {
      sent.push("<closed>");
    },
  };
}

describe("parseSmtpResponse", () => {
  it("reads a single line response", () => {
    expect(parseSmtpResponse("220 smtp.gmail.com ESMTP")).toEqual({
      code: 220,
      lines: ["220 smtp.gmail.com ESMTP"],
      ok: true,
    });
  });

  it("joins a multi line response", () => {
    expect(parseSmtpResponse("250-smtp.gmail.com\n250-SIZE 35882577\n250 AUTH LOGIN PLAIN")).toEqual({
      code: 250,
      lines: ["250-smtp.gmail.com", "250-SIZE 35882577", "250 AUTH LOGIN PLAIN"],
      ok: true,
    });
  });

  it("marks a refusal as not ok", () => {
    expect(parseSmtpResponse("535 5.7.8 Username and Password not accepted").ok).toBe(false);
  });

  it("survives rubbish", () => {
    expect(parseSmtpResponse("hello").code).toBe(0);
  });
});

describe("parseRecipients", () => {
  it("splits a list of addresses", () => {
    expect(parseRecipients("a@b.com, c@d.com; e@f.com")).toEqual(["a@b.com", "c@d.com", "e@f.com"]);
  });

  it("drops the empty ones", () => {
    expect(parseRecipients(" a@b.com , , ")).toEqual(["a@b.com"]);
  });

  it("ignores anything that is not an address", () => {
    expect(parseRecipients("not-an-address, a@b.com")).toEqual(["a@b.com"]);
  });
});

describe("buildMimeMessage", () => {
  it("writes the headers and a base64 body", () => {
    const raw = buildMimeMessage({
      from: "SDHHE <shop@example.com>",
      to: ["a@b.com"],
      subject: "Receipt #12 needs approval",
      html: "<p>Hello</p>",
      date: new Date("2026-11-06T09:45:00.000Z"),
    });
    expect(raw).toContain("From: SDHHE <shop@example.com>");
    expect(raw).toContain("To: a@b.com");
    expect(raw).toContain("Subject: Receipt #12 needs approval");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    const body = raw.split("\r\n\r\n")[1] ?? "";
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("<p>Hello</p>");
  });

  it("keeps the body on lines of 76 characters", () => {
    const raw = buildMimeMessage({
      from: "a@b.com",
      to: ["c@d.com"],
      subject: "x",
      html: "<p>" + "y".repeat(500) + "</p>",
    });
    const body = (raw.split("\r\n\r\n")[1] ?? "").split("\r\n");
    for (const line of body) expect(line.length).toBeLessThanOrEqual(76);
  });
});

describe("SmtpSession", () => {
  it("says hello, signs in and sends one message", async () => {
    const transport = fakeServer([
      "220 smtp.gmail.com ESMTP",
      "250 smtp.gmail.com",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 2.7.0 Accepted",
      "250 2.1.0 Ok",
      "250 2.1.5 Ok",
      "354 End data with <CR><LF>.<CR><LF>",
      "250 2.0.0 Ok: queued",
      "221 2.0.0 Bye",
    ]);

    const session = new SmtpSession(transport);
    const sent = await session.send({
      host: "smtp.gmail.com",
      user: "shop@gmail.com",
      pass: "app-password",
      from: "shop@gmail.com",
      to: ["a@b.com"],
      subject: "Receipt #12",
      html: "<p>Hi</p>",
    });

    expect(sent.ok).toBe(true);
    const commands = transport.sent.join("").split("\r\n");
    expect(commands[0]).toBe("EHLO stock-tracker");
    expect(commands).toContain("AUTH LOGIN");
    expect(commands).toContain("MAIL FROM:<shop@gmail.com>");
    expect(commands).toContain("RCPT TO:<a@b.com>");
    expect(commands).toContain("DATA");
  });

  it("gives up when the password is refused", async () => {
    const transport = fakeServer([
      "220 smtp.gmail.com ESMTP",
      "250 smtp.gmail.com",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "535 5.7.8 Username and Password not accepted",
    ]);
    const session = new SmtpSession(transport);
    const sent = await session.send({
      host: "smtp.gmail.com",
      user: "shop@gmail.com",
      pass: "wrong",
      from: "shop@gmail.com",
      to: ["a@b.com"],
      subject: "x",
      html: "<p>x</p>",
    });
    expect(sent.ok).toBe(false);
    expect(sent.error).toMatch(/535|password/i);
  });

  it("does not send anything when the greeting fails", async () => {
    const transport = fakeServer(["554 no service here"]);
    const session = new SmtpSession(transport);
    const sent = await session.send({
      host: "smtp.gmail.com",
      user: "u",
      pass: "p",
      from: "u@b.com",
      to: ["a@b.com"],
      subject: "x",
      html: "<p>x</p>",
    });
    expect(sent.ok).toBe(false);
    expect(transport.sent.join("")).not.toContain("MAIL FROM");
  });
});
