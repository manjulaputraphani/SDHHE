import { describe, expect, it } from "vitest";
import {
  buildDecisionMail,
  buildPushText,
  buildReceiptMail,
  chatMailConfig,
} from "./chatMail";
import type { ReceiptRequest } from "../../src/db/chat";

const receipt: ReceiptRequest = {
  id: 12,
  submittedBy: 3,
  submitterName: "RAJU",
  title: "Transport bill",
  amountPaise: 45000,
  note: "Paid today",
  r2Key: "receipts/2026-11-06/12.jpg",
  filename: "transport.jpg",
  mime: "image/jpeg",
  sizeBytes: 1024,
  status: "pending",
  decidedBy: null,
  deciderName: null,
  decisionNote: null,
  decidedAt: null,
  messageId: 9,
  createdAt: "2026-11-06T09:45:00.000Z",
};

describe("chatMailConfig", () => {
  it("is null without the secrets", () => {
    expect(chatMailConfig({})).toBeNull();
    expect(chatMailConfig({ SMTP_USER: "a@b.com" })).toBeNull();
  });

  it("uses Gmail by default", () => {
    const config = chatMailConfig({ SMTP_USER: "shop@gmail.com", SMTP_PASS: "app-pass" });
    expect(config).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      user: "shop@gmail.com",
      pass: "app-pass",
      from: "shop@gmail.com",
    });
  });

  it("takes the host, the port and the sender when they are given", () => {
    const config = chatMailConfig({
      SMTP_USER: "shop@gmail.com",
      SMTP_PASS: "app-pass",
      SMTP_FROM: "SDHHE <shop@gmail.com>",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    });
    expect(config?.host).toBe("smtp.example.com");
    expect(config?.port).toBe(587);
    expect(config?.from).toBe("SDHHE <shop@gmail.com>");
  });
});

describe("buildReceiptMail", () => {
  it("names the receipt, the amount and the member", () => {
    const mail = buildReceiptMail(receipt, "RAJU");
    expect(mail.subject).toContain("Receipt #12");
    expect(mail.subject).toContain("Transport bill");
    expect(mail.html).toContain("₹450.00");
    expect(mail.html).toContain("RAJU");
  });
});

describe("buildDecisionMail", () => {
  it("says what happened and by whom", () => {
    const mail = buildDecisionMail(
      { ...receipt, status: "approved", deciderName: "B PHANI KUMAR", decisionNote: "checked" },
      "B PHANI KUMAR",
    );
    expect(mail.subject).toContain("approved");
    expect(mail.html).toContain("B PHANI KUMAR");
    expect(mail.html).toContain("checked");
  });

  it("says it when the receipt was rejected", () => {
    const mail = buildDecisionMail({ ...receipt, status: "rejected" }, "B PHANI KUMAR");
    expect(mail.subject).toContain("rejected");
  });
});

describe("buildPushText", () => {
  it("asks for an approval", () => {
    const push = buildPushText(receipt, "RAJU");
    expect(push.title).toMatch(/waiting/i);
    expect(push.message).toContain("₹450.00");
  });

  it("tells the member what happened", () => {
    const push = buildPushText({ ...receipt, status: "approved" }, "B PHANI KUMAR");
    expect(push.title).toMatch(/approved/i);
    expect(push.message).toContain("Transport bill");
  });
});
