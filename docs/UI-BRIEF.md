# PayeeLock UI Brief

Historical initial design reference. The enhanced implementation and validation are documented in [UI-NOTES.md](UI-NOTES.md); that update supersedes the original pixel-level layout, palette, and component restrictions below.

Target: a payment-control console that reads like Linear/Stripe/Mercury ops tooling, not a landing page. The judge sees it on a projector for ~3 minutes. Every rule below is a number or a yes/no; if a choice isn't listed, default to "less".

Grounding: Anthropic's own [frontend-design skill](https://github.com/anthropics/skills/blob/main/frontend-design/SKILL.md) names the slop defaults (Inter-everywhere, purple gradients on white, predictable card layouts). A [scoring of 1,590 Show HN sites](https://www.adriankrebs.ch/blog/design-slop/) found 54% carried 2+ of 16 slop tells. [Refactoring UI](https://www.sglavoie.com/posts/2023/09/09/book-summary-refactoring-ui/): design in grayscale first, hierarchy via size/weight/color, shadows "mostly invisible". Vercel's [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines): `tabular-nums` on numbers, animate only `transform`/`opacity`, never `transition: all`, honor `prefers-reduced-motion`.

## A. AI-slop tells → fix

Sources: [16 patterns](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), [purple gradient problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website), [21st.dev](https://21st.dev/blog/website-not-look-ai-generated), [Mania](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/).

| # | Tell | Fix for PayeeLock |
|---|------|-------------------|
| 1 | Purple/indigo accent, blue→purple gradient (Tailwind `indigo-500` legacy) | One cold accent (§B), zero gradients anywhere, including buttons and stamps |
| 2 | Colored 3–4px left border on cards ("as reliable as em-dashes") | No colored edge borders. Status lives in the stamp and one 6px dot |
| 3 | Uniform card grid, every card same size/radius/shadow | Center column is a single vertical list with 1px dividers; only the case card has a border |
| 4 | Nested cards inside cards | Max nesting depth 1 (panel → row). Steps are rows, not cards |
| 5 | Same 12–16px radius on everything | 4px controls, 6px panels, 2px stamps/badges. No pills |
| 6 | Emoji as icons (🔒 ✅ ❌) | 14px stroke icons (Lucide/Octicons) or none. Emoji count: 0 |
| 7 | Pastel status badges with rounded-full | Stamps: 2px radius, uppercase 11px, tinted bg + solid text (§C) |
| 8 | Hero copy / marketing headlines ("Protect every payment") | Product name + environment + clock in a 44px topbar. No taglines |
| 9 | Centered text, centered layouts | Everything left-aligned; numbers right-aligned |
| 10 | Stat banner row with gradient text on big numbers | Metric tiles: 20px tabular mono, label 11px, no color unless semantic |
| 11 | Fake/round data ("$10,000", "Acme Corp") | Real-looking: `$48,217.50`, `Northwind Fabrication LLC`, invoice `INV-2026-0912-0417`, IBAN masks |
| 12 | Glassmorphism, blur, neon glows, colored box-shadows | `backdrop-filter` count: 0. Shadows only on popovers/toasts |
| 13 | Bounce/elastic hover, scale-up on hover, everything animated | Hover = background-color 100ms only. Entry motion only for new events (§D) |
| 14 | No hierarchy: everything 14px/500 | 3 sizes, 3 weights, 4 text colors do all the work |
| 15 | All-caps everywhere; Inter at display sizes | Caps only for stamps and section labels (11px, +0.04em). Nothing above 20px except the two demo numbers |
| 16 | Undesigned empty/loading/error states | Every list has an empty state (§C); loading = `…` suffix, not spinners in cards |
| 17 | Generic sidebar with icon+label list | Left rail is a runbook (numbered steps with state) and a queue, not nav |
| 18 | Dark-mode grey text on grey (contrast < 4.5:1) | All text ≥ 4.5:1; primary text ≥ 12:1 |
| 19 | `transition: all 0.3s ease` | Explicit properties; ≤ 200ms UI, ease-out |
| 20 | Everything visible at once, same weight | Progressive disclosure: code/log blocks collapsed by default except on the active case |

## B. Design system

**Fonts.** Keep Inter for UI but enable `font-feature-settings: "cv01","ss03","tnum"` (Linear's setting, [tokens](https://design.hagicode.com/designs/linear.app/DESIGN.md)); the slop tell is Inter at 48px hero, not Inter at 13px. Swap to Geist Sans if you want distance from the default. Mono: JetBrains Mono is fine; Geist Mono/Berkeley Mono are the references. Mono `font-size` is 1px smaller than the surrounding sans (13→12) to match x-height.

**Type scale** (size/line-height/weight; only these seven):

| Token | px/lh | Weight | Use |
|---|---|---|---|
| `t-xs` | 11/16 | 500, +0.04em, uppercase | Section labels, stamps, table headers |
| `t-sm` | 12/16 | 400 | Meta, timestamps, secondary rows |
| `t-base` | 13/20 | 400 | Default UI text, table cells, step rows |
| `t-md` | 14/20 | 500 | Case titles, approval card titles |
| `t-lg` | 16/24 | 500 | Panel headings (rare) |
| `t-xl` | 20/28 | 500, -0.01em | Metric values (mono) |
| `t-2xl` | 28/32 | 600, -0.02em | The one hero number: `$ stopped` |

Weights: 400/500/600 only. Never 700+. Never 300.

**Spacing** (4px base): 4, 8, 12, 16, 24, 32. Panel padding 12px; row padding 8px 12px; gap between panels 1px (divider), not 16px margin.

**Palette.** Neutral-first (Geist's 10-step model: bg 1–3, borders 4–6, text 9–10, [ref](https://vercel.com/geist/colors)). Mercury/Vercel rule: one accent, "Ready/Building/Error traffic light as the only systemic color" ([Mercury](https://www.925studios.co/blog/mercury-design-breakdown), [Vercel](https://oh-my-design.kr/design-systems/vercel)).

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | #FFFFFF | #0B0C0E | page |
| `surface` | #FAFAFA | #121316 | rails, table header |
| `surface-2` | #F4F4F5 | #1A1B1F | hover, code block bg |
| `border` | #E4E4E7 | #26272B | all dividers |
| `border-strong` | #D4D4D8 | #34353A | focused/active card |
| `text` | #18181B | #F2F2F3 | primary |
| `text-2` | #52525B | #B4B6BC | secondary |
| `text-3` | #71717A | #8A8D95 | meta |
| `text-4` | #A1A1AA | #5F626A | disabled, timestamps |
| `accent` | #1F4FD8 | #7A9BFF | primary button, focus ring, active runbook step. Nothing else |
| `ok` / `ok-bg` | #157F3B / #E7F6EC | #3FBF6B / #10281A | EXECUTED, paid |
| `danger` / `danger-bg` | #C42B2B / #FCEBEB | #F0605D / #2E1414 | BLOCKED, denied capability, stopped $ |
| `warn` / `warn-bg` | #9A6700 / #FFF4D6 | #E3B341 / #2D2410 | HELD, awaiting callback |

Color budget per screen: accent ≤ 2 elements, semantic color only on stamps, dots, the $ stopped tile, and denied-capability lines. Everything else is neutral. Stripe's rule: "when every data point is coloured, colour loses meaning" ([Stripe breakdown](https://www.925studios.co/blog/stripe-dashboard-design-breakdown)).

**Borders/shadows.** 1px `border` everywhere; hairlines instead of shadows (Vercel). Shadows only: popover/toast `0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.08)`. Dark mode: shadows off, `border-strong` instead.

**Radius.** 2px stamps/badges/checkboxes; 4px buttons/inputs/code blocks; 6px case card and toast. Max 6.

**Density.** Topbar 44px. Table/list rows 32px (20–30 rows per laptop viewport, [ref](https://modern-ai-web-design.blogspot.com/2026/06/how-to-pick-right-default-row-density.html)). Step rows 28px. Column layout: left 280px, right 320px, center fluid (min 640px). No horizontal padding > 16px anywhere.

**Monospace rules.** Mono + `tabular-nums` for: money, invoice/payee IDs, account masks (`••••4417`), timestamps (`14:02:17.410`), capability names (`net.connect`, `fs.write`), hashes, code, logs, durations (`412ms`). Never for labels, titles, or prose. Money: right-aligned, two decimals, thin-space thousands, currency sign inline: `$48,217.50`. Negative/stopped money never red text in tables, only in the stamp/tile.

## C. Components

**Topbar (44px).** Left: `PayeeLock` 14/500 + env tag `SANDBOX` (t-xs, neutral badge). Center: nothing. Right: mono clock `14:02:17`, agent state dot (6px: grey idle / accent pulse running), `⌘K`. Not: logo mark, tagline, avatar, gradient bar.

**Runbook step (left rail).** 28px rows: 16px numeral circle (1px border; filled accent when active; `ok` check when done), 13/400 label, right-aligned 12px mono meta (`0:42`). States: pending (text-3), active (text + accent ring), done (text-2 + check), failed (danger text). Keyboard: `1–4` jumps to step, `Enter` runs. Not: progress bar, icons per step, "Step 1 of 4" copy.

**Approval card.** Modeled on Linear Triage (`1` accept, `3` decline, `H` snooze; queue advances on action, [docs](https://linear.app/docs/triage)) and Ramp's bill-pay queue that "goes to the next bill in line" ([Ramp](https://support.ramp.com/bill-pay-approvals)). 6px radius, 1px border. Row 1: payee name 14/500 + `HELD` stamp. Row 2 (mono 12): `old ••••4417 → new ••••9031`, requested-by, age (`4m`). Row 3: two ghost buttons `Confirm callback  ⏎` / `Reject  ⌫`, 28px tall, no fill except focus. Reject requires a reason (Brex pattern, [ref](https://www.brex.com/support/brex-business-account-payment-approvals)). Not: avatars, colored left border, "Approve" in green fill, count badges with red circles.

**Case card (center).** Header 40px: 6px status dot, mono case id `#0417`, subject 14/500 truncated, right: `from` (text-3, 12) + mono timestamp + duration. Body = step rows (28px, indented 24px under a 1px vertical guide, Sentry/LangSmith tree style: name left, duration right, nested children under parent [Sentry](https://docs.sentry.io/concepts/key-terms/tracing/trace-view/), [Braintrust](https://www.braintrust.dev/articles/llm-tracing-guide)). Steps: `Inbound email` → `Agent code` → `Sandbox run` → `Proposed actions` → `Ledger decision`. Each step row: 12px chevron (expand), label 13/400, right mono `412ms`; failed step: danger text + `DENIED net.connect` in mono. Only the active case expands; previous cases collapse to header + stamp. Not: cards per step, icons per step, progress stepper with connecting lines, "AI is thinking…" copy.

**Check list (inside Ledger decision).** GitHub PR merge-box pattern: ordered checks, each 24px row: 12px glyph (✓ ok / ✕ danger / – warn), 13/400 name, right mono result (`match`, `Δ $12,400 > cap`) ([GitHub](https://github.blog/changelog/2025-02-12-improved-pull-request-merge-experience-enabled-by-default-in-public-preview/)). Failed checks sort to top. Not: colored rows, badges per check.

**Stamps.** `EXECUTED` / `BLOCKED` / `HELD`: t-xs uppercase 11/500 +0.06em, 2px radius, 1px solid semantic border, tinted bg, semantic text, 20px tall. Demo variant on the active case decision row: 28px tall, 13px text. Only three stamps exist. Not: pill radius, gradient, icon inside, more than one stamp per row.

**Code/log block.** GitHub Actions rules: 12px mono, 18px line-height, line numbers in text-4 gutter, timestamps de-emphasized, grouping collapsible, ANSI-ish semantic color for denied lines only ([GitHub](https://github.blog/news-insights/product-news/a-better-logs-experience-with-github-actions/)). `surface-2` bg, 4px radius, no border, max-height 240px with internal scroll, collapsed to 3 lines + `Show 41 more`. Denied capability lines: `danger` text + `danger-bg` full-row tint. Not: syntax-highlight rainbow, macOS window dots, drop shadow, "Copy" buttons.

**Metrics tiles (right rail top).** Three in a row, 1px dividers, no borders. Label t-xs (`STOPPED`), value t-xl mono tabular. `Stopped $` value in `danger`; `Paid $` neutral; `Held` neutral with count. Value updates via tabular flip (§D). Not: sparklines, deltas, icons, arrows, colored backgrounds.

**Tables (payees / invoices / payments).** 32px rows, header t-xs on `surface`, 1px row dividers, no vertical lines, no zebra. Money right-aligned mono. Status as 6px dot + text, not badge. Row hover `surface-2`. Max 6 columns. Truncate names with `…`. Not: action buttons per row, checkboxes, striped rows, sort icons on every column.

**Empty state.** One 13/400 text-3 line, left-aligned in the panel padding: `No approvals waiting.` Optional mono hint below. Not: illustration, icon, centered block, CTA button.

**Toast.** Bottom-right, 320px, 6px radius, shadow, 12px padding, 13px text + mono detail line, 4s auto-dismiss, max 3 stacked. Used only for callback-confirmed and ledger-executed. Not: colored fills, icons, success checkmark animation.

## D. Motion

Reference: Emil Kowalski's [standards](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md) and [7 tips](https://emilkowal.ski/ui/7-practical-animation-tips): everything < 300ms, ease-out for enter/exit, never `scale(0)`, never `ease-in`, stagger 30–80ms.

```
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

| Transition | Duration / easing |
|---|---|
| Hover/focus bg | 100ms ease |
| Button press | `scale(0.97)`, 120ms ease-out |
| Expand/collapse step or log | height via `grid-template-rows` 0fr→1fr, 180ms ease-out; content opacity 120ms |
| Toast in/out | translateY 8px→0 + opacity, 200ms ease-out; out 150ms |
| Metric value change | digit roll (each digit translateY, 240ms ease-out), no color flash |
| Runbook step activate | ring opacity 150ms |

**New case arrival** (the demo moment): (1) row inserts at top with `opacity 0→1, translateY(-4px)→0`, 180ms ease-out; older cases move down via FLIP transform 200ms ease-in-out, not layout jump. (2) Step rows append one at a time as the real pipeline emits them, each 120ms fade, minimum 60ms apart, no fake delays. (3) Active step shows a 1px accent underline animating width 0→100% only while running (linear, not looping spinner). (4) Denied capability line: bg tint fades in 150ms, no shake. (5) Decision row: stamp appears with `scale(0.96)→1 + opacity`, 200ms ease-out, then 400ms later the `$ stopped` tile digits roll. That 400ms gap is the only deliberate pause; it reads as the ledger committing. No confetti, no glow, no pulse-forever. `prefers-reduced-motion`: drop transforms, keep opacity.

## E. Projector / video rules

Assume 1080p at 6m; halve effective size. Minimums: body 13px (never 11px for anything the judge must read; t-xs is for labels only), mono 12px, contrast 4.5:1 min, primary text 12:1+. Presentation guides say 24pt body on slides ([ref](https://www.presentations.ai/blog/what-font-size-is-best-for-presentations)); a console can't, so instead make exactly two things big: `BLOCKED` stamp on the active case (28px tall) and `$ stopped` (28px mono, danger). Everything else stays quiet. Browser zoom 110–125% for the demo, not larger fonts in CSS. Light theme on a projector (dark grey-on-black washes out); dark tokens are for the video cut. Collapse all prior cases before each runbook step so the active case is above the fold. Turn off the clock's seconds during recording (flicker). No hover-dependent information.

## F. References

1. Linear issue list + Triage ([tokens](https://design.hagicode.com/designs/linear.app/DESIGN.md), [triage](https://linear.app/docs/triage)) — 13px Inter with `cv01/ss03`, 28–32px rows, one indigo accent, keyboard-numbered actions; copy the density and the key hints.
2. Sentry Trace View ([docs](https://docs.sentry.io/concepts/key-terms/tracing/trace-view/)) — left tree of operations, right durations, errors as marks inside the span; copy this for case step rows.
3. GitHub Actions log view ([blog](https://github.blog/news-insights/product-news/a-better-logs-experience-with-github-actions/)) — grouped, line-numbered, de-emphasized timestamps, color only on failing lines; copy for sandbox output.
4. (bonus) Stripe payments table ([breakdown](https://www.925studios.co/blog/stripe-dashboard-design-breakdown)) — right-aligned tabular numerals, muted gridlines, green/red/yellow only for status; copy for the right-rail tables.
