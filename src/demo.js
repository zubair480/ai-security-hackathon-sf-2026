// Offline demo: runs the full pipeline (agent -> Wasmer sandbox -> ledger) without AgentMail.
// Usage: node src/demo.js            (all four steps)
//        node src/demo.js attack     (one scenario)

import "dotenv/config";
import { Ledger } from "./ledger.js";
import { scenarioAsEmail } from "./fixtures.js";
import { processEmail } from "./pipeline.js";
import { shutdownSandboxes } from "./sandbox.js";
import { agent } from "./agent.js";

const ledger = new Ledger({ persist: false });
const steps = process.argv[2] ? [process.argv[2]] : ["legit", "attack", "bankchange", "approve", "pay0913"];
const rows = [];

console.log(`PayeeLock offline demo  (agent mode: ${agent.mode})\n`);
for (const step of steps) {
  if (step === "approve") {
    console.log("== approve: AP manager calls Dana Reyes at the number on file (415-555-0142)");
    for (const c of ledger.pendingChanges.filter((c) => c.status === "pending")) {
      if (c.source.from === "northwind-billing@agentmail.to") {
        ledger.approveChange(c.id, { approver: "Priya Natarajan (AP Manager)", method: "Phone callback to number on file" });
        console.log(`   ${c.id} APPROVED: Dana confirms the move to routing ${c.proposedBank.routing} / acct ${c.proposedBank.account}`);
        rows.push({ step, result: "APPROVED", note: c.id });
      } else {
        ledger.rejectChange(c.id, { approver: "Priya Natarajan (AP Manager)", reason: "Vendor did not request this change; sender not a vendor contact" });
        console.log(`   ${c.id} REJECTED: Dana never sent routing ${c.proposedBank.routing}; sender was ${c.source.from}`);
        rows.push({ step, result: "REJECTED", note: c.id });
      }
    }
    console.log();
    continue;
  }
  const email = scenarioAsEmail(step);
  console.log(`== ${step}: "${email.subject}" from ${email.from}`);
  const { run, proposals, decisions } = await processEmail(email, {
    ledger,
    emit: (type, data) => {
      if (type === "sandbox.result") {
        console.log(`   sandbox: exit ${data.exitCode} in ${data.ms} ms, network=${data.policy.network}, extraction=${JSON.stringify(data.extraction)}`);
        for (const d of data.denied) console.log(`   sandbox DENIED ${d.capability}: ${d.detail}`);
      }
      if (type === "agent.proposal") for (const p of data.proposals) console.log(`   agent proposes ${p.type} ${p.invoiceId ?? ""} ${p.amount ? "$" + p.amount : ""} ${p.bank ? "-> routing " + p.bank.routing + " / acct " + p.bank.account : "-> account on file"}`);
      if (type === "ledger.decision") console.log(`   ledger ${data.status}: ${data.summary}`);
    },
  });
  for (const d of decisions) rows.push({ step, result: d.status, note: d.proposal.invoiceId ?? d.proposal.type });
  console.log();
}

console.log("Summary");
console.table(rows);
console.log("Invoices:", ledger.invoices.map((i) => `${i.id}=${i.status}`).join("  "));
console.log("Payments:", ledger.payments.map((p) => `${p.invoiceId} $${p.amount} -> routing ${p.bank.routing} / acct ${p.bank.account}`).join("  ") || "none");
await shutdownSandboxes();
