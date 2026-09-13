# Prompt for Codex `$frontend-app-builder`

Paste this into Codex (desktop app or `codex` CLI) from the repo root. The `build-web-apps` plugin must be enabled.

---

Use $frontend-app-builder to redesign the PayeeLock console in `web/`.

Context you must read first: `README.md`, `docs/UI-NOTES.md`, `docs/UI-BRIEF.md`, `web/app.js`, `src/server.js`, `src/fixtures.js`. The backend is done and must not change. The front end is vanilla HTML/CSS/JS served statically by Express from `web/`; keep it vanilla and single-page (no React, no build step). Keep every existing contract: `/api/state`, `/api/events` SSE event types, `/api/scenario/:name/send|run`, `/api/changes/:id/approve|reject`, `/api/reset`.

What the product is: an AI accounts-payable agent reads vendor emails (AgentMail), writes a Python extractor that runs in a Wasmer sandbox (network off, only the email and invoice mounted), proposes payments, and a trusted ledger blocks anything that does not match the independently approved payee account. This is a hackathon demo judged live on a projector. The one moment that matters: a look-alike vendor email tries to redirect a $51,900 payment to a new account, and the ledger blocks it while the sandbox denies the email's embedded exfiltration script.

Information architecture to preserve (do not invent sections): a case list (one per inbound email); a case view showing the decision, the proposed account versus the approved account, the ledger checks, and expandable evidence (email, generated Python, sandbox stdout/stderr with denied capabilities, proposals); a queue of bank-change requests awaiting human callback with approve (attestation) and reject (reason); a payee register with invoices and payments; demo controls to run the four scenarios locally or send them as real email; session totals (blocked $, paid $, pending changes).

Design constraints: this is a financial control console, not a landing page. No hero eyebrows, pills, badges, fake metrics, or marketing copy. Real-looking data only (use the fixtures). One accent color. Light theme is primary (projector). The BLOCKED verdict and the blocked dollar amount are the two things that must be readable from six meters. Sandbox denials must be visible on the blocked case without extra clicks.

Workflow: generate the full primary screen concept (blocked case selected) plus the demo-controls state and the review-queue state, then implement to 10/10 fidelity, then verify in the browser against `npm run serve` (set `PORT=4311` to avoid the running instance on 4310) by running all four scenarios with "Run locally" and the approve/reject flow. Run `npm test` at the end. Commit on the current branch.
