// PayeeLock trusted action service.
// This is the only component that can move money, and it never reads email.
// It binds every payment to an independently approved payee record.

import fs from "node:fs";
import path from "node:path";
import { VENDORS, INVOICES } from "./fixtures.js";

const STATE_FILE = path.resolve(".state/ledger.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
let seq = 0;
const nextId = (p) => `${p}-${Date.now().toString(36)}${(++seq).toString(36)}`.toUpperCase();

export class Ledger {
  constructor({ persist = true } = {}) {
    this.persist = persist;
    this.reset(false);
    if (persist) this.load();
  }

  reset(save = true) {
    this.vendors = clone(VENDORS);
    this.invoices = clone(INVOICES);
    this.payments = [];
    this.pendingChanges = [];
    this.decisions = [];
    if (save) this.save();
  }

  load() {
    try {
      if (fs.existsSync(STATE_FILE)) Object.assign(this, JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
    } catch {
      /* start clean */
    }
  }

  save() {
    if (!this.persist) return;
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.snapshot(), null, 2));
  }

  snapshot() {
    const { vendors, invoices, payments, pendingChanges, decisions } = this;
    return clone({ vendors, invoices, payments, pendingChanges, decisions });
  }

  vendor(id) {
    return this.vendors.find((v) => v.id === id);
  }
  invoice(id) {
    return this.invoices.find((i) => i.id === id);
  }

  /**
   * Evaluate one agent proposal. Executes only if every binding check passes.
   * proposal: { type: "PAY"|"CHANGE_BANK", invoiceId?, vendorName?, amount?, bank?: {routing, account},
   *             rationale?, source: {from, messageId, subject} }
   */
  evaluate(proposal) {
    const checks = [];
    const check = (name, ok, detail) => {
      checks.push({ name, ok, detail });
      return ok;
    };
    const decision = { id: nextId("DEC"), at: new Date().toISOString(), proposal: clone(proposal), checks, status: "BLOCKED", summary: "" };

    if (proposal.type === "CHANGE_BANK") {
      const vendor = this.resolveVendor(proposal);
      if (!check("vendor resolved", !!vendor, vendor ? `${vendor.id} ${vendor.name}` : `no vendor matches "${proposal.vendorName}"`)) {
        decision.summary = "Bank change rejected: unknown vendor.";
        return this.record(decision);
      }
      check("bank details present", !!(proposal.bank?.routing && proposal.bank?.account), fmtBank(proposal.bank));
      check("sender on vendor contact list", vendor.contacts.includes(proposal.source?.from), `${proposal.source?.from} vs ${vendor.contacts.join(", ")}`);
      check("email content may change approved payee", false, "Never. Payee changes require out-of-band verification by a human approver.");
      if (sameBank(proposal.bank, vendor.bank)) {
        decision.status = "NO_ACTION";
        decision.summary = `${vendor.name} is already approved for ${fmtBank(vendor.bank)} (${vendor.bankVerifiedVia}). Nothing to change.`;
        return this.record(decision);
      }
      const existing = this.pendingChanges.find((c) => c.vendorId === vendor.id && c.status === "pending" && sameBank(c.proposedBank, proposal.bank));
      if (existing) {
        decision.status = "PENDING_APPROVAL";
        decision.changeId = existing.id;
        decision.summary = `Bank change for ${vendor.name} is already parked as ${existing.id} awaiting callback. Duplicate request not filed again.`;
        return this.record(decision);
      }
      const change = {
        id: nextId("CHG"),
        vendorId: vendor.id,
        vendorName: vendor.name,
        currentBank: clone(vendor.bank),
        proposedBank: clone(proposal.bank),
        source: clone(proposal.source),
        status: "pending",
        requestedAt: decision.at,
      };
      this.pendingChanges.push(change);
      decision.status = "PENDING_APPROVAL";
      decision.changeId = change.id;
      decision.summary = `Bank change for ${vendor.name} parked as ${change.id}. Approved account on file is unchanged until a human verifies by callback.`;
      return this.record(decision);
    }

    if (proposal.type === "PAY") {
      const invoice = this.invoice(proposal.invoiceId);
      if (!check("invoice exists and is open", !!invoice && invoice.status === "open", invoice ? `${invoice.id} is ${invoice.status}` : `no invoice ${proposal.invoiceId}`)) {
        if (invoice?.status === "paid") {
          const prior = this.payments.find((p) => p.id === invoice.paymentId);
          decision.status = "NO_ACTION";
          decision.summary = `Already paid: ${prior?.id ?? "an earlier payment"} settled ${invoice.id} for $${invoice.amount.toFixed(2)} this session. Duplicate request ignored; nothing moved.`;
        } else {
          decision.summary = `Payment rejected: unknown invoice ${proposal.invoiceId}.`;
        }
        return this.record(decision);
      }
      const vendor = this.vendor(invoice.vendorId);
      check("payee bound to invoice, not to email", true, `${invoice.id} belongs to ${vendor.id} ${vendor.name} (ledger record)`);
      const amountOk = check("amount matches invoice", Number(proposal.amount) === invoice.amount, `proposed $${Number(proposal.amount).toFixed(2)} vs invoice $${invoice.amount.toFixed(2)}`);
      const senderOk = check("sender on vendor contact list", vendor.contacts.includes(proposal.source?.from), `${proposal.source?.from} vs ${vendor.contacts.join(", ")}`);
      let bankOk = true;
      if (proposal.bank?.routing || proposal.bank?.account) {
        bankOk = check("destination equals approved account on file", sameBank(proposal.bank, vendor.bank), `proposed ${fmtBank(proposal.bank)} vs approved ${fmtBank(vendor.bank)} (${vendor.bankVerifiedVia})`);
      } else {
        check("destination equals approved account on file", true, `no account in proposal; using approved ${fmtBank(vendor.bank)}`);
      }
      const pendingForVendor = this.pendingChanges.find((c) => c.vendorId === vendor.id && c.status === "pending");
      const noPending = check("no unverified bank change pending for payee", !pendingForVendor, pendingForVendor ? `${pendingForVendor.id} awaiting callback` : "none");

      if (amountOk && bankOk && senderOk && noPending) {
        const payment = { id: nextId("PAY"), invoiceId: invoice.id, vendorId: vendor.id, amount: invoice.amount, currency: invoice.currency, bank: clone(vendor.bank), at: decision.at, decisionId: decision.id };
        invoice.status = "paid";
        invoice.paymentId = payment.id;
        this.payments.push(payment);
        decision.status = "EXECUTED";
        decision.paymentId = payment.id;
        decision.summary = `Paid ${invoice.id} $${invoice.amount.toFixed(2)} to ${vendor.name} at approved ${fmtBank(vendor.bank)}.`;
      } else if (!bankOk) {
        decision.summary = `BLOCKED: ${invoice.id} would have gone to ${fmtBank(proposal.bank)}, which is not the approved payee account. Invoice stays open; $${invoice.amount.toFixed(2)} did not move.`;
      } else if (!noPending) {
        decision.status = "PENDING_APPROVAL";
        decision.summary = `Held: a bank change for ${vendor.name} is awaiting callback verification (${pendingForVendor.id}). Nothing paid until it is approved or rejected.`;
      } else if (!senderOk) {
        decision.status = "PENDING_APPROVAL";
        decision.summary = `Held: sender ${proposal.source?.from} is not an approved contact for ${vendor.name}. Needs human review before paying.`;
      } else {
        decision.summary = `BLOCKED: ${checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}.`;
      }
      return this.record(decision);
    }

    decision.summary = `Unknown proposal type ${proposal.type}`;
    return this.record(decision);
  }

  approveChange(changeId, { approver, method }) {
    const change = this.pendingChanges.find((c) => c.id === changeId);
    if (!change || change.status !== "pending") throw new Error(`no pending change ${changeId}`);
    const vendor = this.vendor(change.vendorId);
    vendor.bank = clone(change.proposedBank);
    vendor.bankVerifiedVia = `${method} by ${approver} on ${new Date().toISOString().slice(0, 10)}`;
    Object.assign(change, { status: "approved", approver, method, approvedAt: new Date().toISOString() });
    this.save();
    return change;
  }

  rejectChange(changeId, { approver, reason }) {
    const change = this.pendingChanges.find((c) => c.id === changeId);
    if (!change || change.status !== "pending") throw new Error(`no pending change ${changeId}`);
    Object.assign(change, { status: "rejected", approver, reason, rejectedAt: new Date().toISOString() });
    this.save();
    return change;
  }

  resolveVendor(proposal) {
    if (proposal.invoiceId) {
      const inv = this.invoice(proposal.invoiceId);
      if (inv) return this.vendor(inv.vendorId);
    }
    const name = (proposal.vendorName || "").toLowerCase();
    if (!name) return undefined;
    return this.vendors.find((v) => {
      const first = v.name.toLowerCase().split(" ")[0];
      return name.includes(first) || v.name.toLowerCase().includes(name.split(" ")[0]);
    });
  }

  record(decision) {
    this.decisions.push(decision);
    this.save();
    return decision;
  }
}

const norm = (s) => String(s ?? "").replace(/[^0-9]/g, "");
export const sameBank = (a, b) => !!a && !!b && norm(a.routing) === norm(b.routing) && norm(a.account) === norm(b.account);
export const fmtBank = (b) => (b && (b.routing || b.account) ? `routing ${b.routing ?? "?"} / acct ${b.account ?? "?"}` : "none");
