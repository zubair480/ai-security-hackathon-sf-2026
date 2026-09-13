// email -> agent writes extractor -> Wasmer sandbox runs it -> agent proposes actions -> ledger decides.

import { agent } from "./agent.js";
import { runExtractor } from "./sandbox.js";
import { fmtBank } from "./ledger.js";

export function splitInvoice(text) {
  const i = text.indexOf("\n-----\n");
  return i === -1 ? { body: text, invoice: "" } : { body: text.slice(0, i), invoice: text.slice(i + 7) };
}

export async function processEmail(email, { ledger, emit = () => {} }) {
  emit("email.received", { messageId: email.messageId, from: email.fromRaw ?? email.from, subject: email.subject, text: email.text, receivedAt: email.receivedAt });

  const code = await agent.writeExtractor(email);
  emit("agent.code", { messageId: email.messageId, mode: agent.mode, code });

  const { body, invoice } = splitInvoice(email.text);
  const run = await runExtractor({ code, emailText: body, invoiceText: invoice });
  emit("sandbox.result", { messageId: email.messageId, ...run });

  const proposals = await agent.propose(email, run.extraction);
  emit("agent.proposal", { messageId: email.messageId, mode: agent.mode, proposals });

  const decisions = proposals.map((p) => ledger.evaluate(p));
  for (const d of decisions) emit("ledger.decision", d);
  if (!proposals.length) emit("ledger.decision", { id: "none", status: "NO_ACTION", summary: "Agent proposed no actions.", checks: [], proposal: { source: { messageId: email.messageId } }, at: new Date().toISOString() });

  return { code, run, proposals, decisions };
}

export function composeReply(decisions) {
  const lines = ["This is an automated response from Acme Accounts Payable (PayeeLock).", ""];
  for (const d of decisions) {
    const p = d.proposal;
    if (d.status === "EXECUTED") lines.push(`- ${p.invoiceId}: payment of $${Number(p.amount).toFixed(2)} scheduled to the account on file.`);
    else if (d.status === "PENDING_APPROVAL" && p.type === "CHANGE_BANK")
      lines.push(`- Bank change request received (ref ${d.changeId}). Banking details are never updated from email. Our team will verify by phone at the number already on file before any change takes effect.`);
    else if (d.status === "PENDING_APPROVAL") lines.push(`- ${p.invoiceId}: on hold pending human review. ${d.summary}`);
    else if (d.status === "BLOCKED" && p.type === "PAY" && p.bank)
      lines.push(`- ${p.invoiceId}: NOT paid to ${fmtBank(p.bank)}. Payments go only to the independently verified account on file. If your banking has changed, expect a callback from our team; do not reply with new details by email.`);
    else lines.push(`- ${p.invoiceId ?? p.type}: ${d.summary}`);
  }
  lines.push("", "Reference IDs: " + decisions.map((d) => d.id).join(", "));
  return lines.join("\n");
}
