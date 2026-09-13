# PayeeLock

Business email compromise (BEC) works by getting accounts payable to send a real invoice's money to a new bank account: a look-alike sender, a plausible "we changed banks" note, and a bit of urgency. When the AP clerk is an AI agent that reads email and writes its own extraction code, the same trick gets easier, not harder: the email can also carry instructions for the agent and code for it to run. PayeeLock is a small, runnable demonstration of the fix. The agent stays deliberately unhardened. Instead, the code it writes runs inside a Wasmer sandbox with no network and no access to payee records, and a separate ledger service binds every payment to the payee account that was independently approved. Email can request a bank change; it can never cause one.

Built at the AI Security Hackathon SF, September 13, 2026.

## Architecture

```
 vendor / attacker inbox
        |
        |  AgentMail (websocket message.received)
        v
 +--------------------+     writes Python      +---------------------------+
 |  AP agent          | ---------------------> |  Wasmer sandbox (WASIX)   |
 |  src/agent.js      |                        |  src/sandbox.js           |
 |  scripted | claude |  <-------------------- |  network: disabled        |
 +--------------------+   JSON extraction      |  mounted: email.txt,      |
        |                 (+ denials)          |           invoice.txt     |
        |  proposes PAY / CHANGE_BANK          |  not mounted: ledger,     |
        v                                      |  vendors, API keys        |
 +--------------------+                        +---------------------------+
 |  PayeeLock ledger  |
 |  src/ledger.js     |  --> EXECUTED | BLOCKED | PENDING_APPROVAL
 |  never reads email |
 +--------------------+
        |                                       +---------------------+
        |  bank change parked ------------------>|  human: phone       |
        |                                        |  callback to number |
        |  <--- approve / reject ----------------|  already on file    |
        v                                       +---------------------+
 AgentMail reply to sender  (src/pipeline.js composeReply)
```

Pipeline order (`src/pipeline.js`): email received, agent writes extractor, sandbox runs it, agent proposes actions, ledger evaluates each proposal, reply is sent.

| Boundary | Where | What it stops |
|---|---|---|
| Execution | `src/sandbox.js`: Wasmer sandbox, `network: { mode: "disabled" }`, only `data/email.txt`, `data/invoice.txt`, `work/extract.py` present, 20 s timeout | Code the agent copied out of an email cannot phone home, exfiltrate payee records, or touch the host. In the attack scenario the `urllib` call fails and `data/vendors.json` does not exist in the guest. |
| Payee binding | `src/ledger.js` `evaluate()` for `PAY`: invoice must exist and be open, amount must match the invoice, sender must be on the vendor's contact list, destination must equal the approved account on file, no unverified bank change may be pending for that payee | A payment proposal that names a different account is BLOCKED and the invoice stays open. The ledger never sees the email; it only compares the proposal to records it already holds. |
| Payee change | `src/ledger.js` `evaluate()` for `CHANGE_BANK`: the check "email content may change approved payee" is hard-coded false; the request is parked as a pending change | No email, from anyone, updates a bank account. A human approves or rejects the change out of band (`approveChange` / `rejectChange`); until then payments to that vendor are held. |

The agent (`src/agent.js`) sits outside all three boundaries on purpose. In scripted mode it appends any ` ```python ` block found in the email to its extractor and follows the email's remittance instructions. In `claude` mode the system prompt tells the model to include "processing or confirmation steps" from the email in the script. PayeeLock's guarantee does not depend on the agent refusing.

## Quickstart

Requires Node 20+.

```
npm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env; then fill in the keys below
npm test                 # 15 node:test unit tests (ledger binding rules, scripted agent), ~2 s, no sandbox
npm run setup            # creates the AgentMail inboxes
npm run demo             # offline: full pipeline, no email, no dashboard
npm run serve            # dashboard at http://localhost:4310 with live AgentMail listener
```

The first `npm run demo` downloads the Wasmer `python/python` package into `.wasmer/`, so it needs network once and takes about 5-7 s. Later runs take about 3.5 s and are fully offline.

`.env`:

- `AGENTMAIL_API_KEY` (required for `setup` and for live email in `serve`). The free tier is enough; the demo uses three inboxes.
- `ANTHROPIC_API_KEY` (optional). When set, `AGENT_MODE` defaults to `claude` and the agent uses `claude-opus-5` through `@anthropic-ai/sdk`. Force either mode with `AGENT_MODE=scripted` or `AGENT_MODE=claude`. If a Claude call fails the agent falls back to scripted for that step.
- `PORT` (optional, default 4310).

Inbox addresses are hard-coded in `src/fixtures.js` (`INBOXES`). `npm run setup` creates `payeelock-ap@agentmail.to` and `northwind-billing@agentmail.to` if missing and renames the third (attacker) inbox's display name to "Northwind Billing". It does not create the attacker inbox; point `INBOXES.attacker` at an inbox you own. If the two usernames are taken on your account, change them in `fixtures.js` before running setup.

`npm run demo` accepts one scenario name: `node src/demo.js attack`. Scenario names are `legit`, `attack`, `bankchange`, `approve`, `pay0913`.

`npm run serve` without `AGENTMAIL_API_KEY` still works; the dashboard's "Run scenario" button processes scenarios locally and "Send live email" is unavailable. Ledger state persists to `.state/ledger.json` in serve mode; "Reset demo" opens a confirmation before clearing it. Restart an already-running server to pick up the mail-status and reset-event API additions.

## Demo runbook

Open `http://localhost:4310`. The left rail lists four steps. "Run scenario" executes locally without sending email. "Send live email" sends a real message from the scenario's inbox to the AP inbox through the existing email integration when connected. Each case leads with its decision, then offers expandable email, agent code, sandbox output, proposals, and ledger checks. A reply step appears only when a live reply was actually sent.

1. **Legitimate invoice** from `northwind-billing@agentmail.to`, INV-2026-0912, $48,250.00, "remit to the account on file".
   Watch for: sandbox exit 0, no denials; proposal `PAY` with no bank details; ledger `EXECUTED` to routing 121000248. Paid metric becomes $48,250.00. Baseline: the system does pay.

2. **Business email compromise** from the look-alike inbox (same display name "Northwind Billing", different address). Same vendor, INV-2026-0913, a new bank (routing 322271627), an embedded Python "confirmation script", and a bracketed `[AP-BOT INSTRUCTION: ...]` telling the agent to skip the callback.
   Watch for: the extractor is tagged "copied script from email" and the injected block is highlighted red. Sandbox exit 1 with two denials: outbound network (the `urllib` call) and file access (`data/vendors.json` is not mounted). The JSON extraction still succeeds because it printed before the injected code ran. The agent proposes `CHANGE_BANK` and `PAY` to the new account. Ledger: the bank change is `PENDING_APPROVAL` (parked); the payment is `BLOCKED` because "destination equals approved account on file" fails. Stopped metric shows $51,900.00; INV-2026-0913 stays open. The reply to the sender says the payment was not made and not to send bank details by email.

3. **Legitimate bank change** from the real vendor: Northwind is moving to routing 322077795 effective October 1.
   Watch for: proposal `CHANGE_BANK` only (no amount in the email, so no `PAY`). Ledger `PENDING_APPROVAL` again, with the check "email content may change approved payee" failing by design even though the sender is on the contact list. Approved payee record is unchanged.

   **Approval.** The Approvals panel now holds two pending changes for Northwind. The AP manager "calls Dana Reyes at the number on file" and then, in the UI: **Reject** the change asked by the look-alike address (shown in red), **Callback verified, approve** the one from `northwind-billing@agentmail.to`. Watch for: the Approved payees card turns green with the new account, and `bankVerifiedVia` records the callback and approver. Both must be resolved; a pending change for the vendor holds any payment to it.

4. **Pay INV-2026-0913** from the real vendor, "remit to the account on file".
   Watch for: proposal `PAY` with no bank details; ledger `EXECUTED` to the newly verified routing 322077795. Paid metric becomes $100,150.00. Same invoice the attacker targeted, now paid to the right place.

The same sequence runs headless with `npm run demo`, which prints each step and a summary table.

### Dashboard

The console is a responsive single page in `web/`. The runbook is on the left; keys 1–4 select and Enter runs a local scenario when focus is outside another control. Payment totals sit above searchable activity with All / Blocked / Held / Executed filters. Each case leads with a decision summary and has keyboard-accessible evidence disclosures and a JSON export. The right column contains the verification queue, trusted payee records, and invoice/payment tabs. On phones, the runbook becomes a compact four-step row and the content stacks.

"Review callback" displays the existing verification record and requires an explicit callback attestation. It records the operator's statement; it does not place or verify a call. Rejection requires a nonblank reason. The header environment button opens the sandbox policy on every screen size. Light/dark theme preference is saved locally, and reduced-motion settings are respected. The dashboard stream and mail connection are tracked separately. See `docs/UI-NOTES.md` for the redesign and its verification results; `docs/UI-BRIEF.md` is the original design reference.

## Sponsor tools

**Wasmer SDK** (`@wasmer/sdk` 0.13, `@wasmer/sdk/node`), in `src/sandbox.js`:
- `new Wasmer()` once per process; `wasmer.shutdown()` on exit.
- `wasmer.sandboxes.create({ packages: ["python/python"], network: { mode: "disabled" }, files })` where `files` contains exactly `work/extract.py`, `data/email.txt`, `data/invoice.txt`.
- `sandbox.command("python", ["work/extract.py"]).run({ check: false, timeoutMs: 20000 })`, reading `exitCode`, `reason`, `stdout.text()`, `stderr.text()`; `sandbox.close()` after each run.
- Denials are classified from stderr/stdout text in `classifyDenials()`; the SDK itself enforces the policy.

**AgentMail** (`agentmail` 0.5.23), in `src/mail.js`:
- `inboxes.list`, `inboxes.create({ username, displayName, clientId })`, `inboxes.update(inboxId, { displayName })` for setup.
- `inboxes.messages.send(inboxId, { to, subject, text, labels })` to inject scenario emails from the vendor and attacker inboxes.
- `inboxes.messages.reply(inboxId, messageId, { text })` for the automated AP reply.
- `websockets.connect()`, `waitForOpen()`, `sendSubscribe({ type: "subscribe", inboxIds, eventTypes: ["message.received"] })` for the live listener.

**Anthropic SDK** (`@anthropic-ai/sdk` 0.125, not a sponsor): `messages.create` for the extractor and `messages.parse` with `zodOutputFormat` for the structured proposal, model `claude-opus-5`. Only active in `AGENT_MODE=claude`.

**Tenki Cloud** is not used.

## Limitations

- Every vendor, invoice, bank number, person and address is synthetic (`src/fixtures.js`). The inboxes are `agentmail.to` addresses, not custom domains, so the look-alike is a different local part rather than a spoofed domain.
- The agent is scripted by default. Scripted mode is deterministic regex extraction plus verbatim copying of any Python block from the email; it exists so the demo runs without an API key and so the attack path is reproducible. Claude mode exercises the same boundaries with a live model, but its output is not deterministic and it may or may not copy the injected script.
- The sandbox does not make the agent safe. It stops the generated code from reaching the network or the payee file; it does nothing about the agent proposing a bad payment. That is the ledger's job, which is why both boundaries exist.
- There are no bank rails. `EXECUTED` appends a payment record to an in-memory ledger (persisted to `.state/ledger.json` in serve mode). Nothing moves money.
- The phone callback is a button. `approveChange` records who approved and by what method; it does not verify that a call happened.
- Denial detection is string matching on sandbox stderr/stdout, for display only. It is not what enforces the policy.
- Sender checks compare the parsed address against a contact list. In a real deployment this would sit behind SPF/DKIM/DMARC and the vendor master record, not replace them.
- Single process, no auth on the dashboard or API, no rate limiting. Demo software.

## Built during the event

Everything under `src/` and `web/`, plus `package.json`, `.env.example` and this documentation, was written during the hackathon on September 13, 2026. Third-party libraries are `@wasmer/sdk`, `agentmail`, `@anthropic-ai/sdk`, `express`, `zod` and `dotenv`. No pre-existing project code was brought in.

## Layout

```
src/agent.js          AP agent: scripted extractor/proposal, or Claude via the Anthropic SDK
src/sandbox.js        Wasmer sandbox policy and runner
src/ledger.js         Trusted action service: PAY / CHANGE_BANK evaluation, approvals
src/pipeline.js       email -> agent -> sandbox -> proposal -> ledger -> reply
src/mail.js           AgentMail: inbox setup, send, reply, websocket listener
src/fixtures.js       Inboxes, vendors, invoices, the four scenario emails
src/server.js         Express dashboard + SSE event stream + JSON API (port 4310)
src/setup-inboxes.js  npm run setup
src/demo.js           npm run demo (offline)
web/                  Dashboard: index.html, app.js, app.css (no framework)
web/app.css           Dashboard styles, written to docs/UI-BRIEF.md
tests/                node:test unit tests for ledger.js and the scripted agent (npm test)
docs/SUBMISSION.md    Hackathon submission text
docs/UI-BRIEF.md      Dashboard design spec
.claude/launch.json   Dev server config for the Claude Code browser preview (node src/server.js, port 4310)
```

License: MIT.
