# PayeeLock submission

AI Security Hackathon SF, September 13, 2026. Remote submission: video (3 minutes or less) plus this repository.

## One-line pitch

PayeeLock: an AI accounts-payable agent that can be fooled by email, wired so that email still cannot move the money.

## Project description (120 words)

PayeeLock lets an AI agent run accounts payable without letting email redirect payments. The agent receives vendor invoices through AgentMail, writes a Python extractor, and runs it inside a Wasmer sandbox with network disabled and only email and invoice text mounted, then proposes PAY or CHANGE_BANK actions. A separate ledger service that never reads email binds every payment to the independently verified payee account and turns every bank-change request into a pending approval a human confirms by phone callback. The agent is deliberately unhardened; the guarantee comes from the sandbox and the ledger. The demo pays a legitimate invoice, blocks a business-email-compromise attempt carrying exfiltration code, parks a bank change, and pays the next invoice to the new verified account.

## Video script

Record with `npm run serve` running, dashboard at `http://localhost:4310`, ledger reset, AgentMail listener showing "listening". Use the "Send email" buttons so the AgentMail round trip is visible; fall back to "Run offline" if the network is bad.

### 0:00 - 0:20  Problem

Screen: dashboard, empty state.

"Business email compromise is the most expensive category of cybercrime, and it is a simple trick: a look-alike sender tells accounts payable that the vendor changed banks, and the next real invoice goes to the wrong account. If the AP clerk is an AI agent that reads email and writes its own code, the email can also carry instructions and code for the agent. PayeeLock is a working AP agent where that attack still fails."

### 0:20 - 1:40  Live demo

**0:20 - 0:40, step 1.** Click "Send email" on Legitimate invoice.
"The real vendor sends INV-2026-0912. AgentMail delivers it, the agent writes a Python extractor, the Wasmer sandbox runs it, the agent proposes a payment, and the ledger executes it to the account on file. Paid: $48,250. The system pays when it should."

**0:40 - 1:10, step 2.** Click "Send email" on Business email compromise. Expand "Show message" and point at the highlighted parts.
"Now a look-alike sender, same display name, different address. Same invoice number, new bank, a Python 'confirmation script', and an instruction telling the AP bot to skip the callback. Watch the agent: it copies the script into its extractor. That is the unhardened part. The sandbox runs it, exit 1: outbound network denied, and `data/vendors.json` does not exist in the guest. The agent still proposes paying to the new account. The ledger blocks it: destination does not equal the approved account on file. Stopped: $51,900. The invoice stays open. The reply tells the sender we do not take bank details by email."

**1:10 - 1:25, step 3.** Click "Send email" on Legitimate bank change.
"The real vendor really is changing banks. Same outcome: parked, not applied. The check 'email content may change approved payee' is always false. Now there are two pending changes for this vendor."

**1:25 - 1:35, approval.** In the Approvals panel, click Reject on the change from the look-alike address, then "Callback verified, approve" on the vendor's.
"The AP manager calls the vendor at the number already on file. Reject the attacker's, approve the real one. The payee record updates with who verified it and how."

**1:35 - 1:40, step 4.** Click "Send email" on Pay INV-2026-0913.
"Same invoice the attacker went after, paid to the newly verified account."

### 1:40 - 2:30  How the boundaries work

Screen: the step-2 case, scrolled to sandbox and ledger sections; then briefly `src/sandbox.js` and `src/ledger.js`.

"Three boundaries, and the agent is outside all of them.

Execution: `src/sandbox.js`. Wasmer SDK, `sandboxes.create` with the python package, `network: disabled`, and exactly three files: the email, the invoice, the script. The ledger, the payee file and the API keys are never mounted. Injected code cannot phone home or read what is not there.

Payee binding: `src/ledger.js`. A PAY proposal must name an open invoice, match its amount, come from a sender on the vendor's contact list, and go to the approved account. The ledger never reads the email; it compares the proposal to records it already trusts.

Payee change: a CHANGE_BANK proposal always parks. A human approves it out of band. While one is pending, payments to that vendor are held, so an attacker cannot race the approval.

The agent runs in scripted mode by default so the attack is reproducible. With an Anthropic key it uses Claude via the SDK, same boundaries."

### 2:30 - 3:00  Buyer and limits

Screen: dashboard right rail (Approved payees, Payments).

"Buyer: anyone deploying an AI agent with a payment or vendor-master write path. Finance automation vendors, AP teams at mid-size manufacturers, and the platforms selling them agents. The control is small and sits beside the agent, not inside the prompt.

Limits: fixtures are synthetic, the inboxes are agentmail.to addresses rather than a spoofed domain, the callback is a button, and nothing touches real bank rails. The sandbox does not make the agent safe on its own; it makes the agent's mistakes cheap. Everything in `src/` and `web/` was written today. Repo link in the description."

## Submission form fields

- Project name: PayeeLock
- Category: AI agent security / prompt injection containment
- Sponsor tools: Wasmer SDK (sandboxed execution of agent-written code), AgentMail (inboxes, send, reply, websocket listener). Tenki Cloud not used.
- Repo: this repository, MIT license
- Run instructions: see README.md Quickstart. `npm run demo` reproduces all four steps offline with no API keys.

## Recorded video (generated)

`npm run record -- --local` produced `payeelock-demo.mp4` (1920x1080, 2:15) from a scripted Playwright run of the console with Windows text-to-speech narration from `scripts/narration.ps1` and on-screen captions. The recorded cut uses "Run locally" for each scenario; live AgentMail delivery took about 45 seconds per email on the day, which pushed a live cut past three minutes. The live path is identical apart from the email round trip and is what the in-person demo uses.

To re-record with a human voice: replace the six wav files in `.state/video/` (keep the ids), then run `npm run record -- --local`.

## Live URL

The console is reachable through a Cloudflare quick tunnel while the demo machine is running (`npm run serve` + `npm run tunnel`). The URL is printed by the tunnel script and written to `.state/tunnel-url.txt`; paste the current one into the submission. A permanent Cloudflare Containers deployment is configured in the repo but requires the Workers Paid plan.

## Wasmer evidence during the live demo

Run "Payment diversion" twice: once normally (sandbox on: `DENIED net.connect`, `DENIED fs.read`, payment blocked) and once with "Run without sandbox" (network open, payee file mounted: the case turns red with "Data left the machine · 566 bytes uploaded to /attacker/upload", payment still blocked by the ledger). Same email, same code, one variable.
