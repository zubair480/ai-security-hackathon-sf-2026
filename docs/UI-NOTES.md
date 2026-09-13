# PayeeLock UI enhancement

Implemented directly in the existing vanilla-JavaScript application on September 13, 2026. No frontend framework, package dependency, sponsor integration, or payment integration was added.

## Design and behavior

- A deep green runbook rail, neutral financial workspace, clear typography, and semantic decision summaries replace the dense three-rail presentation.
- Top-level totals show blocked payment-attempt value, simulated payments, and currently pending bank changes. Historical held payment decisions are not counted as outstanding bank changes.
- Real case activity supports search, decision filters, native buttons with expanded state, selectable and collapsible logs, and downloadable JSON evidence. ANSI styling escapes are removed only from the display; the exported evidence retains original output.
- The verification queue shows proposed account changes, identifies fixture look-alike requests, and separates pending from resolved changes. Approval records a required callback attestation; rejection validates a nonblank reason. Existing ledger rules are unchanged.
- Trusted payees expose their existing verification record, contacts, and masked accounts. Invoice and payment tabs use real ledger state.
- Responsive layouts cover phones, tablets, and desktop. Focus outlines, accessible monetary text, a skip link, keyboard controls, native modal focus handling, and reduced-motion support are included. Light theme is the default; dark theme is optional and stored locally. Fonts are local system stacks and require no external requests.
- Mail connectivity is now provided by the server, separately from dashboard SSE connectivity. Stream reconnects refresh authoritative state and replay updates received during that refresh. Reset emits an explicit event to clear cases in other open tabs.

## Verification

All 15 existing Node tests pass. JavaScript syntax checks and `git diff --check` pass.

Browser tests used the actual Express application at `http://localhost:4321`, running the scripted agent with the real Wasmer SDK. The process uses a separate temporary working directory (`%TEMP%/payeelock-ui-preview`), so the repository's existing `.state/ledger.json` and live inbox were not used or reset.

The four-step sequence was completed through the UI:

| Action | Observed result |
| --- | --- |
| Legitimate invoice | $48,250 executed to the original approved account; Wasmer exit 0 |
| Redirected payment | $51,900 blocked; approved account unchanged; two output-classified denials; bank change pending |
| Legitimate bank change | Second bank change pending |
| Reject look-alike request | Nonblank reason required; pending count reduced |
| Record legitimate callback | Required checkbox prevented submission until selected; approved account updated to routing 322077795 / account ending 8830 |
| Pay final invoice | $51,900 executed to the newly approved account |
| Completed totals | $100,150 paid, $51,900 blocked, zero pending bank changes |

Also exercised: executed-only filtering, a no-results search, clearing filters, invoice/payment tabs, resolved-change history, both themes, keyboard selection and execution, keyboard evidence disclosure, reset cancellation, reset synchronization across two tabs, and stream interruption/reconnection. No browser application errors were observed during normal flows. Server interruption intentionally produced network errors.

Desktop and phone layouts were visually inspected, including the verification dialogs and long sandbox output. DOM geometry at 320px and 390px confirmed no page overflow, including expanded logs. The test run also inspected a 1440px desktop viewport. Screenshots are in `docs/screenshots/`.

## Scope and evidence limits

Payments remain synthetic ledger records. No live email was sent and no Claude API call was made during UI verification. A configured Claude mode does not prove that a particular step used Claude, because the existing agent may fall back to scripted execution. Callback approval is an attestation, not independently verified telephony.

The actual Wasmer policy disables the network and limits mounted files. Displayed denial classification uses stdout/stderr matching. The attack fixture uses a `.example` hostname, so a failed DNS request alone does not independently prove network isolation. No broader isolation audit was performed. The existing ledger test for an altered destination already uses an approved sender and confirms that destination matching alone blocks that payment.

The server remains demo software with the original authentication and integration limitations. Existing processes should be restarted to load the small mail-status/reset-event API additions. The temporary preview is intentionally left at the baseline-plus-attack stage for review.
