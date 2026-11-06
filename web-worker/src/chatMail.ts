/**
 * Mail + push for the Team Chat (Phase 12, T-12.7).
 *
 * A receipt that waits for approval and the decision that follows both go
 * out by **Gmail SMTP** (the worker-mailer way) and as an ntfy push.
 * Everything here is best effort: a mail that cannot be sent must never stop
 * a member from sending a message or approving a receipt.
 */
import { formatRupees } from "../../src/logic/units";
import type { ReceiptRequest } from "../../src/db/chat";
import type { SmtpConfig, SmtpResult } from "./mailer";

export type MailSender = (
  config: SmtpConfig,
  content: { to: string[]; subject: string; html: string },
) => Promise<SmtpResult>;

export type PushSender = (
  topic: string | undefined,
  title: string,
  message: string,
) => Promise<boolean>;

/** The SMTP settings of the worker (null when the mail is not set up). */
export function chatMailConfig(env: {
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
}): SmtpConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT ?? "465");
  return {
    host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number.isFinite(port) && port > 0 ? port : 465,
    user,
    pass,
    from: env.SMTP_FROM?.trim() || user,
  };
}

function receiptLines(receipt: ReceiptRequest): string {
  return [
    `<li><b>${receipt.title}</b> — ${formatRupees(receipt.amountPaise)}</li>`,
    receipt.note ? `<li>${receipt.note}</li>` : "",
    `<li>From ${receipt.submitterName}</li>`,
    `<li>Receipt #${receipt.id}</li>`,
  ]
    .filter(Boolean)
    .join("");
}

/** The mail that tells the owners that a receipt is waiting. */
export function buildReceiptMail(
  receipt: ReceiptRequest,
  actorName: string,
): { subject: string; html: string } {
  return {
    subject: `Receipt #${receipt.id} needs approval — ${receipt.title}`,
    html: `<p><b>${actorName}</b> sent a receipt that needs approval.</p><ul>${receiptLines(receipt)}</ul><p>Approve or reject it in Team Chat.</p>`,
  };
}

/** The mail that tells the submitter what happened to the receipt. */
export function buildDecisionMail(
  receipt: ReceiptRequest,
  deciderName: string,
): { subject: string; html: string } {
  const verb = receipt.status === "approved" ? "approved" : "rejected";
  return {
    subject: `Receipt #${receipt.id} was ${verb}`,
    html: `<p><b>${deciderName}</b> ${verb} your receipt.</p><ul>${receiptLines(receipt)}</ul>${
      receipt.decisionNote ? `<p>Note: ${receipt.decisionNote}</p>` : ""
    }`,
  };
}

/** The one-line text that goes into the push notification. */
export function buildPushText(
  receipt: ReceiptRequest,
  actorName: string,
): { title: string; message: string } {
  if (receipt.status === "pending") {
    return {
      title: "Receipt waiting for approval",
      message: `${actorName} sent "${receipt.title}" (${formatRupees(receipt.amountPaise)})`,
    };
  }
  const verb = receipt.status === "approved" ? "approved" : "rejected";
  return {
    title: `Receipt ${verb}`,
    message: `${actorName} ${verb} "${receipt.title}" (${formatRupees(receipt.amountPaise)})`,
  };
}
