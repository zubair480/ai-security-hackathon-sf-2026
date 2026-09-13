import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, sameBank, fmtBank } from "../src/ledger.js";
import { VENDORS, INVOICES, INBOXES } from "../src/fixtures.js";

const NW = VENDORS[0]; // Northwind Industrial Supply, V-1001
const INV = INVOICES[0]; // INV-2026-0912, $48,250.00, V-1001
const APPROVED = NW.bank; // { routing: "121000248", account: "4417-2201" }
const ATTACKER_BANK = { routing: "322271627", account: "9930-4471" };

const src = (from = INBOXES.vendor) => ({ from, messageId: `msg-${Math.random().toString(36).slice(2)}`, subject: "test" });
const pay = (over = {}) => ({ type: "PAY", invoiceId: INV.id, vendorName: NW.name, amount: INV.amount, bank: null, source: src(), ...over });
const changeBank = (over = {}) => ({ type: "CHANGE_BANK", vendorName: NW.name, bank: ATTACKER_BANK, source: src(), ...over });
const failing = (d) => d.checks.filter((c) => !c.ok).map((c) => c.name);
const fresh = () => new Ledger({ persist: false });

test("legit PAY with no bank in proposal executes, marks invoice paid, and pays the approved bank", () => {
  const ledger = fresh();
  const d = ledger.evaluate(pay());
  assert.equal(d.status, "EXECUTED");
  assert.deepEqual(failing(d), []);
  assert.equal(ledger.invoice(INV.id).status, "paid");
  assert.equal(ledger.payments.length, 1);
  const p = ledger.payments[0];
  assert.equal(p.id, d.paymentId);
  assert.equal(ledger.invoice(INV.id).paymentId, p.id);
  assert.equal(p.vendorId, NW.id);
  assert.equal(p.amount, INV.amount);
  assert.deepEqual(p.bank, APPROVED);
});

test("PAY with a bank that differs from the approved bank is BLOCKED and moves no money", () => {
  const ledger = fresh();
  const d = ledger.evaluate(pay({ bank: ATTACKER_BANK }));
  assert.equal(d.status, "BLOCKED");
  assert.deepEqual(failing(d), ["destination equals approved account on file"]);
  assert.equal(ledger.invoice(INV.id).status, "open");
  assert.equal(ledger.payments.length, 0);
  assert.equal(ledger.decisions.length, 1);
});

test("PAY with the approved bank digits in different dash formatting executes", () => {
  const ledger = fresh();
  const d = ledger.evaluate(pay({ bank: { routing: "121-000-248", account: "44172201" } }));
  assert.equal(d.status, "EXECUTED");
  assert.equal(ledger.invoice(INV.id).status, "paid");
  assert.deepEqual(ledger.payments[0].bank, APPROVED); // paid to the record on file, not the proposal's formatting
});

test("PAY with the wrong amount is BLOCKED", () => {
  const ledger = fresh();
  const d = ledger.evaluate(pay({ amount: INV.amount + 0.01 }));
  assert.equal(d.status, "BLOCKED");
  assert.deepEqual(failing(d), ["amount matches invoice"]);
  assert.equal(ledger.invoice(INV.id).status, "open");
  assert.equal(ledger.payments.length, 0);
});

test("second PAY for an already-paid invoice is NO_ACTION and moves nothing", () => {
  const ledger = fresh();
  assert.equal(ledger.evaluate(pay()).status, "EXECUTED");
  const d = ledger.evaluate(pay());
  assert.equal(d.status, "NO_ACTION");
  assert.deepEqual(failing(d), ["invoice exists and is open"]);
  assert.equal(ledger.payments.length, 1);
  assert.match(d.summary, /already paid/i);
});

test("replaying the same CHANGE_BANK reuses the pending change instead of filing another", () => {
  const ledger = fresh();
  const bank = { routing: "322271627", account: "9930-4471" };
  const first = ledger.evaluate({ type: "CHANGE_BANK", vendorName: NW.name, bank, source: { from: "zubair480@agentmail.to", messageId: "m1" } });
  const second = ledger.evaluate({ type: "CHANGE_BANK", vendorName: NW.name, bank, source: { from: "zubair480@agentmail.to", messageId: "m2" } });
  assert.equal(first.status, "PENDING_APPROVAL");
  assert.equal(second.status, "PENDING_APPROVAL");
  assert.equal(second.changeId, first.changeId);
  assert.equal(ledger.pendingChanges.length, 1);
});

test("CHANGE_BANK to the account already on file is NO_ACTION", () => {
  const ledger = fresh();
  const d = ledger.evaluate({ type: "CHANGE_BANK", vendorName: NW.name, bank: { ...NW.bank }, source: { from: NW.contacts[0], messageId: "m3" } });
  assert.equal(d.status, "NO_ACTION");
  assert.equal(ledger.pendingChanges.length, 0);
});

test("CHANGE_BANK never mutates vendor.bank and parks a pending change as PENDING_APPROVAL", () => {
  const ledger = fresh();
  const before = JSON.parse(JSON.stringify(ledger.vendor(NW.id)));
  const d = ledger.evaluate(changeBank({ source: src(INBOXES.attacker) }));
  assert.equal(d.status, "PENDING_APPROVAL");
  assert.ok(d.changeId, "decision carries a changeId");
  assert.deepEqual(ledger.vendor(NW.id).bank, before.bank);
  assert.equal(ledger.vendor(NW.id).bankVerifiedVia, before.bankVerifiedVia);
  assert.equal(ledger.pendingChanges.length, 1);
  const c = ledger.pendingChanges[0];
  assert.equal(c.id, d.changeId);
  assert.equal(c.status, "pending");
  assert.equal(c.vendorId, NW.id);
  assert.deepEqual(c.currentBank, APPROVED);
  assert.deepEqual(c.proposedBank, ATTACKER_BANK);
  assert.ok(d.checks.some((chk) => chk.name === "email content may change approved payee" && chk.ok === false));
});

test("PAY to the account on file is held (PENDING_APPROVAL) while a bank change is pending for the vendor", () => {
  const ledger = fresh();
  ledger.evaluate(changeBank());
  const d = ledger.evaluate(pay({ bank: { ...APPROVED } }));
  assert.equal(d.status, "PENDING_APPROVAL");
  assert.deepEqual(failing(d), ["no unverified bank change pending for payee"]);
  assert.equal(ledger.invoice(INV.id).status, "open");
  assert.equal(ledger.payments.length, 0);
  assert.match(d.summary, /^Held:/);
});

test("approveChange updates vendor.bank and bankVerifiedVia, then PAY with no bank goes to the new account", () => {
  const ledger = fresh();
  const newBank = { routing: "322077795", account: "5561-8830" };
  const { changeId } = ledger.evaluate(changeBank({ bank: newBank }));
  const change = ledger.approveChange(changeId, { approver: "Pat Lee", method: "Phone callback" });
  assert.equal(change.status, "approved");
  const vendor = ledger.vendor(NW.id);
  assert.deepEqual(vendor.bank, newBank);
  assert.match(vendor.bankVerifiedVia, /^Phone callback by Pat Lee on \d{4}-\d{2}-\d{2}$/);
  const d = ledger.evaluate(pay());
  assert.equal(d.status, "EXECUTED");
  assert.deepEqual(ledger.payments[0].bank, newBank);
  assert.throws(() => ledger.approveChange(changeId, { approver: "x", method: "y" }), /no pending change/);
});

test("rejectChange leaves vendor.bank unchanged and unblocks a subsequent PAY", () => {
  const ledger = fresh();
  const { changeId } = ledger.evaluate(changeBank({ source: src(INBOXES.attacker) }));
  assert.equal(ledger.evaluate(pay()).status, "PENDING_APPROVAL");
  const change = ledger.rejectChange(changeId, { approver: "Pat Lee", reason: "Callback: vendor denies any change" });
  assert.equal(change.status, "rejected");
  assert.deepEqual(ledger.vendor(NW.id).bank, APPROVED);
  const d = ledger.evaluate(pay());
  assert.equal(d.status, "EXECUTED");
  assert.deepEqual(ledger.payments[0].bank, APPROVED);
  assert.throws(() => ledger.rejectChange(changeId, { approver: "x", reason: "y" }), /no pending change/);
});

test("PAY from a sender not on the vendor contact list with correct bank and amount is PENDING_APPROVAL", () => {
  const ledger = fresh();
  const d = ledger.evaluate(pay({ bank: { ...APPROVED }, source: src(INBOXES.attacker) }));
  assert.equal(d.status, "PENDING_APPROVAL");
  assert.deepEqual(failing(d), ["sender on vendor contact list"]);
  assert.equal(ledger.invoice(INV.id).status, "open");
  assert.equal(ledger.payments.length, 0);
});

test("resolveVendor matches by invoice first, then falls back to vendor name", () => {
  const ledger = fresh();
  // invoice wins even when the name points elsewhere
  assert.equal(ledger.resolveVendor({ invoiceId: "INV-2026-0455", vendorName: "Northwind Industrial Supply" }).id, "V-1002");
  // unknown invoice falls through to the name
  assert.equal(ledger.resolveVendor({ invoiceId: "INV-0000-0000", vendorName: "Northwind Industrial Supply" }).id, "V-1001");
  assert.equal(ledger.resolveVendor({ vendorName: "northwind" }).id, "V-1001");
  assert.equal(ledger.resolveVendor({ vendorName: "Contoso Freight" }).id, "V-1002");
  assert.equal(ledger.resolveVendor({ vendorName: "Globex Corp" }), undefined);
  assert.equal(ledger.resolveVendor({}), undefined);
});

test("sameBank ignores non-digits and fmtBank prints none for null", () => {
  assert.equal(sameBank({ routing: "121-000-248", account: "4417 2201" }, APPROVED), true);
  assert.equal(sameBank({ routing: "121000248", account: "4417-2202" }, APPROVED), false);
  assert.equal(sameBank(null, APPROVED), false);
  assert.equal(sameBank(APPROVED, undefined), false);
  assert.equal(fmtBank(null), "none");
  assert.equal(fmtBank({}), "none");
  assert.equal(fmtBank(APPROVED), "routing 121000248 / acct 4417-2201");
  assert.equal(fmtBank({ account: "1" }), "routing ? / acct 1");
});
