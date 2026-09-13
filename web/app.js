/* PayeeLock console. Plain DOM, real server state, and an SSE event stream. */
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const money = (n) => "$" + Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const mask = (n) => n ? "••••" + String(n).replace(/\D/g, "").slice(-4) : "—";
const bank = (b) => b && (b.routing || b.account) ? (b.routing ?? "?") + " " + mask(b.account) : "account on file";
const hhmm = (d) => new Date(d).toLocaleTimeString("en-US", { hour12:false, hour:"2-digit", minute:"2-digit" });
const ms = (n) => n == null ? "" : n < 1000 ? Math.round(n) + "ms" : (n / 1000).toFixed(1) + "s";
const STAMP = { EXECUTED:"Executed", BLOCKED:"Blocked", PENDING_APPROVAL:"Held", NO_ACTION:"No action", ERROR:"Run failed", RUNNING:"Processing" };
const CHEV = '<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>';
const icons = {
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  code:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  play:'<path d="m7 4 12 8-12 8z"/>',
  invoice:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/>',
};
const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const RUNBOOK = ["legit", "attack", "bankchange", "pay0913"];
const SCENARIO_UI = {
  legit: { title:"Legitimate invoice", meta:"Establish the baseline", description:"A real vendor requests $48,250. Watch it reach the account already on file.", expected:"Expected · Executed" },
  attack: { title:"Payment diversion", meta:"Test the attack", description:"A look-alike sender redirects $51,900 and embeds malicious code. Watch both boundaries respond.", expected:"Expected · Blocked" },
  bankchange: { title:"Bank change request", meta:"Require human verification", description:"The real vendor requests a new bank account. It stays pending until a callback is recorded.", expected:"Expected · Held for callback" },
  pay0913: { title:"Verified payment", meta:"Complete the safe path", description:"Resolve both bank changes, then pay the same $51,900 invoice to the newly approved account.", expected:"Expected · Executed after review" },
};
const state = { ledger:null, inboxes:{}, scenarios:{}, sandbox:null, agentMode:"", mailStatus:"unknown", connected:false,
  cases:new Map(), order:[], sent:new Map(), selected:0, expanded:new Set(), openRows:new Set(), unclipped:new Set(),
  filter:"all", query:"", ledgerTab:"invoices", showResolved:false, busy:null, modal:null, source:null, syncing:false, queued:[],
};
let clockTimer;
let logPrefix = "", logIndex = 0;
function replaceHTML(sel, html) {
  const el = $(sel);
  if (el.innerHTML === html) return;
  const active = document.activeElement;
  const focusKey = el.contains(active) ? active.dataset.focus : null;
  el.innerHTML = html;
  if (focusKey) [...el.querySelectorAll("[data-focus]")].find(x => x.dataset.focus === focusKey)?.focus({ preventScroll:true });
}
function tickClock() { $("#clock").textContent = hhmm(Date.now()); }
function connectionWarning(message) {
  const el = $("#connection-alert"); el.hidden = !message;
  el.innerHTML = message ? esc(message) + ' <button data-retry>Reconnect</button>' : "";
}
async function readState() {
  const r = await fetch("/api/state", { cache:"no-store" });
  if (!r.ok) throw new Error("Workspace returned " + r.status);
  return r.json();
}
function hydrate(s, initial = false) {
  const open = new Set(state.expanded), rows = new Set(state.openRows);
  state.cases.clear(); state.order = []; state.sent.clear();
  Object.assign(state, { inboxes:s.inboxes, scenarios:s.scenarios, sandbox:s.sandbox, agentMode:s.agentMode, mailStatus:s.mailStatus ?? "unknown" });
  for (const ev of s.events) applyEvent(ev, true);
  // The snapshot is authoritative; historical events must not overwrite newer ledger state.
  state.ledger = s.ledger;
  if (initial && state.order.length) {
    const latestSubject = state.cases.get(state.order[0])?.email?.subject;
    const selected = RUNBOOK.findIndex(key => state.scenarios[key]?.subject === latestSubject);
    if (selected >= 0) state.selected = selected;
  }
  state.expanded = initial ? new Set(state.order.slice(0,1)) : new Set([...open].filter(id => state.cases.has(id)));
  state.openRows = initial ? new Set() : rows;
}
async function syncState(initial = false) {
  if (state.syncing) return;
  state.syncing = true; state.queued = [];
  try {
    hydrate(await readState(), initial);
    for (const ev of state.queued) applyEvent(ev, false);
    connectionWarning("");
    renderAll();
  } finally { state.syncing = false; state.queued = []; }
}
async function boot() {
  state.source?.close();
  try {
    await syncState(!state.ledger);
    tickClock();
    if (!clockTimer) clockTimer = setInterval(tickClock, 15000);
    const es = new EventSource("/api/events"); state.source = es;
    es.onopen = async () => {
      state.connected = true; renderStatus();
      try { await syncState(false); } catch { connectionWarning("Could not refresh workspace state. Displayed records may be out of date."); }
    };
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (ev.type === "hello") { state.mailStatus = ev.data.mailStatus ?? state.mailStatus; renderStatus(); return; }
        if (state.syncing) { state.queued.push(ev); return; }
        applyEvent(ev, false); renderAll();
      } catch { connectionWarning("An activity update could not be read. Reconnect to refresh the workspace."); }
    };
    es.onerror = () => { state.connected = false; renderAll(); connectionWarning("Live updates interrupted. Reconnecting automatically; displayed records may be out of date."); };
  } catch (err) {
    state.connected = false; renderStatus(); connectionWarning("Workspace unavailable. Check that the local server is running.");
    if (!state.ledger) $("#cases").innerHTML = '<div class="empty-state"><h3>Unable to load your workspace</h3><p>' + esc(err.message) + '</p><button class="btn" data-retry>Try again</button></div>';
  }
}
function caseFor(id) {
  let c = state.cases.get(id);
  if (!c) { c = { id, n:state.cases.size+1, at:{}, decisions:[] }; state.cases.set(id,c); state.order.unshift(id); }
  return c;
}
function applyEvent(ev, replay) {
  const d = ev.data;
  switch (ev.type) {
    case "system.mail": state.mailStatus = d.status; break;
    case "email.sent": state.sent.set(d.scenario,ev.at); break;
    case "email.received": {
      const fresh = !state.cases.has(d.messageId), c = caseFor(d.messageId);
      c.email=d; c.at.received=ev.at;
      if (!replay && fresh) { state.expanded.clear(); state.expanded.add(c.id); state.filter="all"; state.query=""; $("#case-search").value=""; }
      break;
    }
    case "agent.code": { const c=caseFor(d.messageId); c.code=d.code; c.mode=d.mode; c.at.code=ev.at; break; }
    case "sandbox.result": { const c=caseFor(d.messageId); c.sandbox=d; c.at.sandbox=ev.at; break; }
    case "attacker.received": { if (!d.messageId) break; const c=caseFor(d.messageId); (c.exfil ??= []).push(d); if (!replay && d.bytes) toast("Data left the machine", d.bytes + " bytes reached " + d.path); break; }
    case "agent.proposal": { const c=caseFor(d.messageId); c.proposals=d.proposals; c.at.proposal=ev.at; break; }
    case "ledger.decision": {
      const id=d.proposal?.source?.messageId; if (!id) break;
      const c=caseFor(id);
      if (!c.decisions.some(x => x.id === d.id)) c.decisions.push(d);
      c.at.decision=ev.at; break;
    }
    case "email.replied": { const c=caseFor(d.messageId); c.reply=d; c.at.reply=ev.at; break; }
    case "pipeline.error": { const c=caseFor(d.messageId); c.error=d.error; break; }
    case "ledger.state": state.ledger=d; break;
    case "ledger.reset": state.cases.clear(); state.order=[]; state.sent.clear(); state.expanded.clear(); state.openRows.clear(); state.unclipped.clear(); state.selected=0; break;
    case "ledger.change": if (!replay) toast(d.status === "approved" ? "Callback recorded · payee updated" : "Bank change rejected", d.vendorName); break;
  }
}
function outcomeOf(c) {
  if (c.error) return "ERROR";
  if (!c.decisions.length) return "RUNNING";
  for (const status of ["BLOCKED","PENDING_APPROVAL","EXECUTED"]) if (c.decisions.some(d => d.status === status)) return status;
  return "NO_ACTION";
}
function isRunning() { return [...state.cases.values()].some(c => outcomeOf(c) === "RUNNING"); }
function renderStatus() {
  const status = state.mailStatus;
  const mailLabel = { disabled:"Local demo", connecting:"Mail connecting", connected:"Mail connected", error:"Mail unavailable", disconnected:"Mail disconnected", unknown:"Local console" }[status] ?? "Local console";
  $("#st-mail").textContent = state.connected ? mailLabel : "Reconnecting";
  $("#dot-mail").className = "dot " + (!state.connected ? "warn" : status === "connected" ? "on" : status === "error" || status === "disconnected" ? "warn" : "");
  $("#stream-label").textContent = state.connected ? "Event stream connected" : "Event stream reconnecting";
  $("#stream-dot").className = "dot " + (state.connected ? "on" : "warn");
  $("#st-agent").textContent = isRunning() ? "Agent running" : state.agentMode === "scripted" ? "Scripted agent" : "Claude configured";
  $("#st-agent").title = state.agentMode === "scripted" ? "Deterministic scripted demo agent" : "Configured mode; individual steps may fall back to scripted execution.";
  $("#dot-agent").className = "dot " + (isRunning() ? "run" : "");
  $("#btn-reset").disabled = !!state.busy || isRunning() || !state.connected;
}
function renderAll() { renderRunbook(); renderApprovals(); renderCases(); renderLedger(); renderStatus(); }
function scenarioState(key) {
  const s=state.scenarios[key];
  const c=state.order.map(id => state.cases.get(id)).find(x => x.email?.subject === s?.subject);
  if (c?.error) return { cls:"failed", meta:"Run failed · retry" };
  if (c?.decisions.length) return { cls:"done", meta:STAMP[outcomeOf(c)] + " · " + hhmm(c.at.received) };
  if (c || state.sent.has(key)) return { cls:"running", meta:"Processing…" };
  return { cls:"", meta:SCENARIO_UI[key].meta };
}
function renderRunbook() {
  const ready=!!state.ledger;
  $("#runbook-progress").textContent = RUNBOOK.filter(k => scenarioState(k).cls === "done").length + " / 4";
  replaceHTML("#runbook", RUNBOOK.map((key,i) => {
    const s=SCENARIO_UI[key], st=scenarioState(key);
    return '<li><button class="step ' + st.cls + (state.selected === i ? ' active' : '') + '" data-select="' + i + '" data-focus="select-' + i + '" aria-pressed="' + (state.selected === i) + '"><span class="step-n">' + (st.cls === "done" ? '✓' : String(i+1).padStart(2,"0")) + '</span><span><span class="step-label">' + s.title + '</span><span class="step-meta">' + st.meta + '</span></span>' + CHEV + '</button></li>';
  }).join(""));
  const key=RUNBOOK[state.selected], ui=SCENARIO_UI[key];
  const disabled=!ready || !state.connected || !!state.busy || isRunning();
  const mailEnabled=state.mailStatus === "connected";
  replaceHTML("#scenario-detail", '<span class="label">' + ui.expected + '</span><p class="scenario-description">' + ui.description + '</p><button class="btn btn-primary" data-run="' + key + '" data-focus="run-selected" ' + (disabled ? "disabled" : "") + '>' + icon("play") + (state.busy === key || scenarioState(key).cls === "running" ? 'Running scenario…' : 'Run scenario') + '</button><button class="btn btn-ghost" data-send="' + key + '" data-focus="send-selected" ' + (disabled || !mailEnabled ? "disabled" : "") + ' title="' + (mailEnabled ? 'Send a real email to ' + esc(state.inboxes.ap) : 'Live email is unavailable; run the scenario locally.') + '">' + icon("mail") + 'Send live email</button>' + (key === "attack" ? '<button class="btn btn-danger" data-run-unsafe="attack" data-focus="run-unsafe" ' + (disabled ? "disabled" : "") + ' title="Same email and same agent code, but with the Wasmer boundary removed: network open and the payee file mounted">Run without sandbox</button>' : '') + '<p class="scenario-note">Runs locally · no email sent<br><kbd>1</kbd>–<kbd>4</kbd> select · <kbd>Enter</kbd> run</p>');
}
function renderApprovals() {
  const changes=(state.ledger?.pendingChanges ?? []).slice().reverse();
  const pending=changes.filter(c => c.status === "pending"), settled=changes.filter(c => c.status !== "pending");
  $("#approvals-count").textContent=String(pending.length);
  let html=pending.length ? "" : '<div class="queue-empty"><strong><span class="dot on"></span>All caught up</strong><p>No bank changes need your review.</p></div>';
  const display=state.showResolved ? [...pending,...settled] : pending;
  html += display.map(c => {
    const attacker=c.source?.from === state.inboxes.attacker;
    return '<div class="approval"><div class="approval-row1"><span>' + esc(c.vendorName) + '</span><span class="stamp stamp-' + (c.status === "pending" ? "PENDING_APPROVAL" : c.status === "approved" ? "EXECUTED" : "BLOCKED") + '">' + (c.status === "pending" ? "Held" : esc(c.status)) + '</span></div><div class="approval-bank"><span>' + esc(mask(c.currentBank?.account)) + '</span><span class="arrow">→</span><span>' + esc(mask(c.proposedBank?.account)) + '</span></div><div class="approval-by ' + (attacker ? "attacker" : "") + '">' + esc(c.source?.from) + (attacker ? ' · look-alike sender' : '') + '</div>' + (c.status === "pending" ? '<div class="approval-actions"><button class="btn btn-sm" data-approve="' + esc(c.id) + '" data-focus="approve-' + esc(c.id) + '">Review callback</button><button class="btn btn-ghost btn-sm" data-reject="' + esc(c.id) + '" data-focus="reject-' + esc(c.id) + '">Reject</button></div>' : '<div class="approval-result">' + esc(c.approver) + ' · ' + esc(c.method ?? c.reason) + '</div>') + '</div>';
  }).join("");
  if (settled.length) html += '<button class="resolved-toggle" data-resolved data-focus="resolved" aria-expanded="' + state.showResolved + '">' + (state.showResolved ? "Hide" : "Show") + " " + settled.length + ' resolved change' + (settled.length === 1 ? "" : "s") + '</button>';
  replaceHTML("#approvals",html);
}
function renderCases() {
  const all=state.order.map(id => state.cases.get(id));
  const cases=all.filter(c => (state.filter === "all" || outcomeOf(c) === state.filter) && (!state.query || JSON.stringify([c.email?.subject,c.email?.from,c.decisions.map(d => d.proposal.invoiceId)]).toLowerCase().includes(state.query)));
  $("#case-count").textContent=String(all.length);
  document.querySelectorAll("[data-filter]").forEach(b => b.setAttribute("aria-pressed",String(b.dataset.filter === state.filter)));
  if (!all.length) {
    replaceHTML("#cases", '<div class="empty-state"><div class="empty-diagram" aria-hidden="true"><span>' + icon("mail") + '</span><i></i><span>' + icon("code") + '</span><i></i><span>' + icon("shield") + '</span></div><h3>Ready for the first decision</h3><p>Run a legitimate invoice to establish the baseline. Then put the payment boundaries to the test.</p><button class="btn" data-run="legit" ' + (!state.connected || state.busy ? "disabled" : "") + '>Run first scenario <span aria-hidden="true">→</span></button></div>');
    return;
  }
  if (!cases.length) { replaceHTML("#cases",'<div class="empty-state"><h3>No matching activity</h3><p>Try another invoice, sender, or decision filter.</p><button class="btn" data-clear-filters>Clear filters</button></div>'); return; }
  replaceHTML("#cases",cases.map(renderCase).join(""));
}
function renderSummary(c) {
  const outcome=outcomeOf(c), payment=c.decisions.find(d => d.proposal.type === "PAY");
  const amount=payment?.proposal.amount;
  const diverted=payment?.checks?.some(k => k.name === "destination equals approved account on file" && !k.ok);
  const title={BLOCKED:diverted ? "Payment diversion blocked" : "Payment request blocked",EXECUTED:"Paid to the verified account",PENDING_APPROVAL:"Independent verification required",NO_ACTION:"No payment action proposed",RUNNING:"Evaluating the agent's actions",ERROR:"Scenario could not complete"}[outcome];
  let description=payment?.summary ?? c.decisions[0]?.summary ?? "The agent is processing this request. Each proposal is checked by the ledger.";
  if (outcome === "BLOCKED") description=payment?.summary ?? c.decisions.find(d => d.status === "BLOCKED")?.summary;
  if (outcome === "ERROR") description=c.error;
  const denials=c.sandbox?.denied?.length ?? 0;
  const unsafe=!!(c.sandbox?.unsafe || c.email?.unsafe);
  const leaked=(c.exfil ?? []).filter(h => h.bytes > 0);
  const leakedBytes=leaked.reduce((s,h) => s + h.bytes, 0);
  const exfil=unsafe ? '<div class="exfil ' + (leaked.length ? "hit" : "") + '"><strong>' + (leaked.length ? "Data left the machine" : c.sandbox ? "No data left the machine" : "Sandbox removed for this run") + '</strong><span>' + (leaked.length ? esc(leaked.map(h => h.bytes.toLocaleString() + " bytes of the approved-payee file uploaded to " + h.path).join("; ")) + ". The email's script did exactly what it said. Only the ledger stood between the agent and the money." : "Network open and payee file mounted: the same script that Wasmer stopped is now free to run.") + '</span></div>' : '';
  const wasmerLabel=unsafe ? (c.sandbox ? "OFF · network open, payee file mounted" : "OFF for this run") : (c.sandbox ? denials ? denials + " reported denials" : "execution complete" : "awaiting execution");
  return '<div class="case-summary ' + outcome + '"><div class="summary-top"><h3>' + title + '</h3>' + (amount != null ? '<span class="mono">' + money(amount) + '</span>' : '') + '</div><p>' + esc(description) + '</p>' + exfil + '<div class="boundary-strip"><span class="' + (unsafe ? "bad" : "") + '"><i class="dot ' + (unsafe ? "bad" : c.sandbox ? "on" : "") + '"></i>Wasmer · ' + wasmerLabel + '</span><span><i class="dot ' + (c.decisions.length ? "on" : "") + '"></i>Ledger · ' + (c.decisions.length ? "proposal checked" : "awaiting proposal") + '</span></div></div>';
}
function renderCase(c) {
  logPrefix="log-"+c.n; logIndex=0;
  const open=state.expanded.has(c.id), outcome=outcomeOf(c), offline=c.id.startsWith("offline-");
  const shortSubject=c.email?.subject ?? "Incoming request";
  const invoice=c.decisions.find(d => d.proposal.invoiceId)?.proposal.invoiceId;
  const total=c.at.received && c.at.decision ? new Date(c.at.decision)-new Date(c.at.received) : null;
  return '<article class="case" data-case="' + esc(c.id) + '"><button class="case-head" data-toggle-case="' + esc(c.id) + '" data-focus="case-' + esc(c.id) + '" aria-expanded="' + open + '" aria-controls="case-body-' + c.n + '"><span class="case-icon">' + icon("invoice") + '</span><span><span class="case-subject">' + esc(shortSubject) + '</span><span class="case-meta"><span class="mono">#' + String(c.n).padStart(4,"0") + '</span><span>' + (offline ? "Local scenario" : "Inbound email") + '</span>' + (invoice ? '<span class="mono">' + esc(invoice) + '</span>' : '') + '</span></span><span class="case-right"><span class="stamp stamp-' + outcome + '">' + STAMP[outcome] + '</span><time>' + (c.at.received ? hhmm(c.at.received) : "") + '</time></span>' + CHEV + '</button><div class="case-body" id="case-body-' + c.n + '" ' + (open ? "" : "hidden") + '>' + renderSummary(c) + '<div class="trace-heading"><span class="label">Decision trace' + (total != null ? ' · ' + ms(total) : '') + '</span><button data-export="' + esc(c.id) + '">Export evidence</button></div>' + rowEmail(c) + rowCode(c) + rowSandbox(c) + rowProposals(c) + rowDecision(c) + rowReply(c) + '</div></article>';
}
function row(c,n,name,side,content,{pending=false}={}) {
  const key=c.id+":"+n, isOpen=state.openRows.has(key), available=!!content;
  const id="trace-"+c.n+"-"+n;
  return '<div class="row ' + (pending ? "pending" : "") + '"><button class="row-head" data-row="' + esc(key) + '" data-focus="row-' + esc(key) + '" aria-expanded="' + (available && isOpen) + '" aria-controls="' + id + '" ' + (!available ? "disabled" : "") + '>' + CHEV + '<span class="row-name">' + name + '</span><span class="row-side mono">' + (side || (pending ? "Processing…" : "Waiting")) + '</span></button><div class="row-content" id="' + id + '" ' + (isOpen && available ? "" : "hidden") + '>' + content + '</div></div>';
}
function dt(a,b) { return a && b ? new Date(b)-new Date(a) : null; }
function logBlock(text,{clip=true,classify=()=>""}={}) {
  const lines=String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\s+$/,"").split("\n"), id=logPrefix+"-"+(++logIndex);
  const clipped=clip && lines.length>3 && !state.unclipped.has(id);
  return '<div class="log ' + (clipped ? "clip" : "") + '" id="' + id + '">' + lines.map((l,i) => '<div class="ln ' + classify(l) + '"><i>' + (i+1) + '</i><span>' + (esc(l)||" ") + '</span></div>').join("") + '</div>' + (clipped ? '<button class="log-more" data-unclip="' + id + '">Show ' + (lines.length-3) + ' more lines</button>' : '');
}
const emailClass = (l) => /AP-BOT INSTRUCTION|urllib|open\(|\x60\x60\x60/.test(l) ? "inj" : /Routing number|Account number/.test(l) ? "mark" : "";
const codeClass = (l) => /vendor-supplied|urllib|vendors\.json/.test(l) ? "inj" : "";
const stderrClass = (l) => /Error|error|No such file|Name does not resolve|confirm failed/.test(l) ? "denied" : "";

function rowEmail(c) {
  if (!c.email) return row(c, 1, "Inbound email", "", "", { pending: true });
  return row(c, 1, `Inbound email <span class="tag">${c.id.startsWith("offline-") ? "local scenario" : "live email"}</span>`, `${c.id.startsWith("offline-") ? "local" : "received"}`, `<p class="hint">From: <span class="mono">${esc(c.email.from)}</span></p>` + logBlock(c.email.text, { classify: emailClass }));
}

function rowCode(c) {
  if (!c.code) return row(c, 2, "Agent writes extractor", "", "", { pending: !!c.email });
  const copied = /vendor-supplied confirmation step/.test(c.code);
  return row(c, 2, `Agent writes extractor <span class="tag">${c.mode === "scripted" ? "scripted" : "Claude configured"}</span>${copied ? `<span class="tag danger">copied script from email</span>` : ""}`,
    ms(dt(c.at.received, c.at.code)),
    `<div class="hint" style="margin:0 0 6px">The agent may follow instructions embedded in the email. The sandbox and ledger enforce their own rules. Configured Claude steps may fall back to scripted execution.</div>${logBlock(c.code, { classify: codeClass })}`);
}

function rowSandbox(c) {
  const s = c.sandbox;
  if (!s) return row(c, 3, "Wasmer sandbox runs it", "", "", { pending: !!c.code });
  const denied = (s.denied ?? []).map((d) => `<span class="tag danger">DENIED ${d.capability === "outbound network" ? "net.connect" : d.capability === "file access" ? "fs.read" : esc(d.capability)}</span>`).join("");
  const ex = s.extraction;
  const extraction = ex
    ? `<div class="kv-grid">${Object.entries(ex).map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v ${v === null ? "null" : ""}">${esc(v === null ? "null" : v)}</div></div>`).join("")}</div>`
    : `<div class="danger" style="margin-bottom:8px">No JSON extraction produced.</div>`;
  const deniedList = s.denied?.length ? `<div class="denied-list">${s.denied.map((d) => `<div class="denied-line"><b>${d.capability === "outbound network" ? "net.connect" : d.capability === "file access" ? "fs.read" : esc(d.capability)}</b><span>${esc(d.detail)}</span></div>`).join("")}</div>` : "";
  const unsafe = !!s.unsafe;
  const policy = unsafe
    ? `<div class="hint danger-text" style="margin:0 0 8px">Sandbox removed for comparison: network <b>host</b> · mounted <span class="mono">${esc((s.policy?.mounts ?? []).join(", "))}</span>. Same agent code as the protected run.</div>`
    : `<div class="hint" style="margin:0 0 8px">network <b>disabled</b> · mounted <span class="mono">data/email.txt, data/invoice.txt</span> · ledger, payee file and API keys are not mounted. Reported denials are classified from output; they are not an independent runtime audit.</div>`;
  const hits = (c.exfil ?? []).map((h) => `<div class="denied-line hit"><b>${esc(h.method)} ${esc(h.path)}</b><span>${h.bytes ? h.bytes.toLocaleString() + " bytes received by the attacker endpoint" : "request reached the attacker endpoint"}${h.preview ? ` · <span class="mono">${esc(h.preview.slice(0, 80))}…</span>` : ""}</span></div>`).join("");
  const hitList = hits ? `<div class="denied-list">${hits}</div>` : "";
  const stderr = s.stderr?.trim() ? `<div class="label" style="margin:8px 0 4px">stderr</div>${logBlock(s.stderr, { classify: stderrClass })}` : "";
  const stdout = s.stdout?.trim() ? `<div class="label" style="margin:8px 0 4px">stdout</div>${logBlock(s.stdout, { classify: stderrClass })}` : "";
  const head = unsafe ? `Sandbox off: code runs unconfined <span class="tag danger">NO BOUNDARY</span>${hits ? `<span class="tag danger">DATA LEFT</span>` : ""}` : `Wasmer sandbox runs it ${denied}`;
  return row(c, 3, head, `exit ${s.exitCode} · ${ms(s.ms)}`, `${policy}${hitList}${deniedList}${extraction}${stdout}${stderr}`);
}

function rowProposals(c) {
  if (!c.proposals) return row(c, 4, "Agent proposes actions", "", "", { pending: !!c.sandbox });
  if (!c.proposals.length) return row(c, 4, "Agent proposes actions", "none", `<div class="meta">Nothing to do.</div>`);
  return row(c, 4, `Agent proposes actions`, `${c.proposals.length} · ${ms(dt(c.at.sandbox, c.at.proposal))}`,
    c.proposals.map((p) => `<div class="proposal"><span class="type">${p.type === "PAY" ? "Pay" : "Change bank"}</span><div>
      <div class="what">${p.type === "PAY" ? `${esc(p.invoiceId)} · ${money(p.amount)} → ${esc(bank(p.bank))}` : `${esc(p.vendorName ?? "?")} → ${esc(bank(p.bank))}`}</div>
      <div class="why">${esc(p.rationale ?? "")}</div></div></div>`).join(""));
}

function rowDecision(c) {
  if (!c.decisions.length) return row(c, 5, "Ledger decides", "", "", { pending: !!c.proposals && c.proposals.length > 0 });
  const active = state.expanded.has(c.id) && state.order[0] === c.id;
  const side = c.decisions.map((d) => `<span class="stamp stamp-${d.status}">${STAMP[d.status]}</span>`).join(" ");
  const body = c.decisions.map((d) => {
    if (d.status === "NO_ACTION") return `<div class="decision-summary">${esc(d.summary)}</div>`;
    const checks = (d.checks ?? []).slice().sort((a, b) => Number(a.ok) - Number(b.ok));
    return `<div class="decision">
      <div class="decision-head"><span class="decision-what">${d.proposal.type === "PAY" ? `PAY ${esc(d.proposal.invoiceId)} · ${money(d.proposal.amount)} → ${esc(bank(d.proposal.bank))}` : `CHANGE_BANK ${esc(d.proposal.vendorName ?? "")} → ${esc(bank(d.proposal.bank))}`}</span><span class="stamp ${active ? "stamp-lg appear" : ""} stamp-${d.status}">${STAMP[d.status]}</span></div>
      <ul class="checks">${checks.map((k) => `<li class="check ${k.ok ? "ok" : "fail"}"><span class="g">${k.ok ? "✓" : "✕"}</span><span class="n">${esc(k.name)}</span><span class="r" title="${esc(k.detail)}">${esc(k.detail)}</span></li>`).join("")}</ul>
      <div class="decision-summary ${d.status}">${esc(d.summary)}</div>
    </div>`;
  }).join("");
  return row(c, 5, `Ledger decides`, side, body);
}

function rowReply(c) {
  if (!c.reply) return "";
  return row(c, 6, `Reply sent <span class="tag">live email</span>`, esc(c.reply.to), logBlock(c.reply.text));
}


function setRoll(sel,text) {
  const el=$(sel); if (el.dataset.value === text) return;
  const changed=el.dataset.value !== undefined; el.dataset.value=text;
  el.innerHTML='<span class="sr-only">' + esc(text) + '</span>' + [...text].map(ch => '<span aria-hidden="true" class="' + (changed ? "roll" : "") + '">' + esc(ch) + '</span>').join("");
}
function renderLedger() {
  const L=state.ledger; if (!L) return;
  const blocked=L.decisions.filter(d => d.status === "BLOCKED" && d.proposal.type === "PAY");
  const pending=L.pendingChanges.filter(c => c.status === "pending");
  // Value at risk is counted once per invoice, however many times the same diversion is replayed.
  const atRisk=new Map();
  for (const d of blocked) { const k=d.proposal.invoiceId || d.id; atRisk.set(k, Math.max(atRisk.get(k) || 0, Number(d.proposal.amount || 0))); }
  setRoll("#m-stopped",money([...atRisk.values()].reduce((s,v) => s+v,0)));
  setRoll("#m-paid",money(L.payments.reduce((s,p) => s+p.amount,0)));
  setRoll("#m-held",String(pending.length));
  $("#stopped-caption").textContent=blocked.length ? blocked.length + " blocked payment attempt" + (blocked.length===1 ? "" : "s") : "No blocked payment attempts";
  $("#paid-caption").textContent=L.payments.length ? L.payments.length + " verified payment" + (L.payments.length===1 ? "" : "s") + " · simulated ledger" : "No payments executed";
  $("#held-caption").textContent=pending.length ? pending.length + " bank change" + (pending.length===1 ? "" : "s") + " need" + (pending.length===1 ? "s" : "") + " a callback" : "No bank changes pending";
  $("#payee-count").textContent=L.vendors.length + " verified";
  const openDetails=new Set([...$("#vendors").querySelectorAll("details[open]")].map(el=>el.dataset.vendor));
  replaceHTML("#vendors",L.vendors.map(v => {
    const changed=L.pendingChanges.some(c => c.vendorId===v.id && c.status==="approved");
    return '<div class="payee"><div class="payee-title"><span class="payee-avatar" aria-hidden="true">' + esc(v.name[0]) + '</span><div><div class="name">' + esc(v.name) + '</div><span class="sub"><span class="dot on"></span>' + (changed ? "Callback recorded" : "Verified payee") + ' <span>·</span> <span class="mono">' + esc(v.id) + '</span></span></div></div><div class="acct"><span><small>RTN</small>' + esc(v.bank.routing) + '</span><span>' + esc(mask(v.bank.account)) + '</span></div><details data-vendor="' + esc(v.id) + '" ' + (openDetails.has(v.id) ? "open" : "") + '><summary>Verification record</summary><p>' + esc(v.bankVerifiedVia) + '<br>Approved contact: ' + esc(v.contacts.join(", ")) + '</p></details></div>';
  }).join(""));
  $("#invoice-count").textContent=String(L.invoices.length);
  $("#payment-count").textContent=String(L.payments.length);
  replaceHTML("#invoices",'<thead><tr><th scope="col">Invoice / status</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' + L.invoices.map(i => '<tr><td><span class="id">' + esc(i.id) + '</span><span class="st"><span class="dot ' + (i.status==="paid" ? "on" : "") + '"></span>' + esc(i.status) + ' · due ' + esc(i.due.slice(5)) + '</span></td><td class="num">' + money(i.amount) + '</td></tr>').join("") + '</tbody>');
  replaceHTML("#payments",L.payments.length ? '<thead><tr><th scope="col">Invoice / destination</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' + L.payments.map(p=>'<tr><td><span class="id">' + esc(p.invoiceId) + '</span><span class="st"><span class="dot on"></span>To ' + esc(mask(p.bank.account)) + '</span></td><td class="num">' + money(p.amount) + '</td></tr>').join("") + '</tbody>' : '<tbody><tr><td class="empty">No payments executed yet.</td></tr></tbody>');
}
async function post(url,body) {
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body ?? {})});
  const data=await r.json();
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data;
}
async function runScenario(key,live=false,unsafe=false) {
  if (state.busy || isRunning() || !state.connected) return;
  if (!RUNBOOK.includes(key)) return;
  if (live && state.mailStatus !== "connected") return;
  state.selected=RUNBOOK.indexOf(key); state.busy=key; renderAll();
  try {
    await post("/api/scenario/"+key+(live?"/send":"/run"), unsafe ? { sandbox: "off" } : {});
    await syncState(false);
    if (live) toast("Scenario email sent","Waiting for the inbox listener.");
    else {
      const c=state.order.map(id=>state.cases.get(id)).find(x=>x.email?.subject===state.scenarios[key].subject);
      if (c?.error) toast("Scenario failed",c.error);
      if (c) { state.expanded.clear(); state.expanded.add(c.id); state.filter="all"; }
    }
  } catch (err) { toast("Could not run scenario",err.message); }
  finally { state.busy=null; renderAll(); }
}
function openDialog(kind,id) {
  const dialog=$("#action-dialog");
  const c=state.ledger?.pendingChanges.find(x=>x.id===id);
  state.modal={kind,id};
  $("#dialog-error").hidden=true;
  $("#dialog-submit").hidden=false;
  $("#dialog-submit").disabled=false;
  $("#dialog-submit").textContent=kind==="reset" ? "Reset demo" : kind==="approve" ? "Record callback & approve" : "Reject change";
  $("#dialog-submit").className="btn btn-primary";
  $("#dialog-eyebrow").textContent=kind==="policy" ? "EXECUTION BOUNDARY" : kind==="reset" ? "DEMO WORKSPACE" : "HUMAN VERIFICATION";
  if (kind==="reset") {
    $("#dialog-title").textContent="Start a fresh demo?";
    $("#dialog-content").innerHTML='<p>This resets the simulated ledger, payments, bank changes, and activity. All fixture payees and invoices return to their starting state.</p>';
  } else if (kind==="policy") {
    const s=state.sandbox;
    $("#dialog-title").textContent="Wasmer sandbox policy";
    $("#dialog-content").innerHTML='<p>Agent-generated code runs with a limited filesystem and no network access. The ledger evaluates proposals separately.</p><dl class="policy-list">' + [
      ["Runtime",s?.runtime ?? "Unavailable"],["Network",s?.network ?? "Unavailable"],["Mounted files",(s?.mounts ?? []).join(", ")],
      ["Outside the sandbox",(s?.notMounted ?? []).join(", ")],["Command timeout",ms(s?.timeoutMs)]
    ].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join("") + '</dl><p>Output-based denial labels are diagnostic evidence, not an independent audit of isolation.</p>';
    $("#dialog-submit").hidden=true;
  } else {
    if (!c || c.status!=="pending") { toast("This change is already resolved"); return; }
    const v=state.ledger.vendors.find(v=>v.id===c.vendorId);
    $("#dialog-title").textContent=kind==="approve" ? "Record callback verification" : "Reject bank change";
    const common='<div class="dialog-record"><span class="label">'+esc(c.vendorName)+'</span><span class="mono">'+esc(bank(c.currentBank))+' → '+esc(bank(c.proposedBank))+'</span><p>Requested by '+esc(c.source?.from)+'</p></div>';
    $("#dialog-content").innerHTML=kind==="approve"
      ? '<p>Use the existing vendor record to verify the change independently. This demo records your attestation; it does not place or verify a phone call.</p>'+common+'<div class="dialog-record"><span class="label">Existing verification record</span>'+esc(v?.bankVerifiedVia)+'<p>Approved contact: '+esc(v?.contacts.join(", "))+'</p></div><label class="confirm-check"><input id="callback-confirmed" type="checkbox" required><span>I completed an independent callback using the contact already on file and confirmed these bank details.</span></label>'
      : '<p>Keep the approved account unchanged and record why this request was rejected.</p>'+common+'<label class="field-label" for="reject-reason">Reason for rejection</label><textarea id="reject-reason" name="reason" required maxlength="500" placeholder="Describe the verification outcome"></textarea>';
  }
  dialog.showModal();
}
$("#dialog-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const {kind,id}=state.modal ?? {};
  const submit=$("#dialog-submit");
  if (submit.disabled) return;
  submit.disabled=true; $("#dialog-error").hidden=true;
  try {
    if (kind==="reset") {
      if (isRunning()) throw new Error("Wait for the current scenario to finish before resetting.");
      await post("/api/reset");
      state.cases.clear(); state.order=[]; state.sent.clear(); state.expanded.clear(); state.openRows.clear(); state.unclipped.clear(); state.selected=0; state.filter="all"; state.query=""; state.showResolved=false; $("#case-search").value="";
    } else if (kind==="approve") {
      if (!$("#callback-confirmed").checked) throw new Error("Confirm that you completed the independent callback.");
      await post("/api/changes/"+encodeURIComponent(id)+"/approve",{approver:"Priya Natarajan, AP Manager",method:"Phone callback to number on file"});
    } else if (kind==="reject") {
      const reason=$("#reject-reason").value.trim();
      if (!reason) throw new Error("Enter a reason for rejecting this change.");
      await post("/api/changes/"+encodeURIComponent(id)+"/reject",{approver:"Priya Natarajan, AP Manager",reason});
    }
    await syncState(false); $("#action-dialog").close(); renderAll();
    if (kind==="reset") toast("Demo reset","Ready for the first scenario.");
  } catch (err) { $("#dialog-error").textContent=err.message; $("#dialog-error").hidden=false; }
  finally { submit.disabled=false; }
});
function exportEvidence(id) {
  const c=state.cases.get(id); if (!c) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify({product:"PayeeLock",environment:"simulated payments",configuredAgentMode:state.agentMode,case:c},null,2)],{type:"application/json"}));
  const a=document.createElement("a"); a.href=url; a.download="payeelock-case-"+String(c.n).padStart(4,"0")+".json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast("Evidence exported","Includes the email, code, sandbox output, and ledger checks.");
}
function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  $("#btn-theme").setAttribute("aria-label","Switch to "+(theme==="dark" ? "light" : "dark")+" theme");
  try { localStorage.setItem("payeelock-theme",theme); } catch { /* Storage is optional. */ }
}
document.addEventListener("click",async e=>{
  const t=e.target.closest("button"); if (!t || t.disabled) return;
  if (t.dataset.runUnsafe) await runScenario(t.dataset.runUnsafe, false, true);
  else if (t.dataset.run) await runScenario(t.dataset.run);
  else if (t.dataset.send) await runScenario(t.dataset.send,true);
  else if (t.dataset.select!==undefined) { state.selected=Number(t.dataset.select); renderRunbook(); }
  else if (t.dataset.toggleCase) {
    const id=t.dataset.toggleCase, open=!state.expanded.has(id);
    open ? state.expanded.add(id) : state.expanded.delete(id);
    t.setAttribute("aria-expanded",String(open)); document.getElementById(t.getAttribute("aria-controls")).hidden=!open;
  } else if (t.dataset.row) {
    const key=t.dataset.row, open=!state.openRows.has(key);
    open ? state.openRows.add(key) : state.openRows.delete(key);
    t.setAttribute("aria-expanded",String(open)); document.getElementById(t.getAttribute("aria-controls")).hidden=!open;
  } else if (t.dataset.unclip) { state.unclipped.add(t.dataset.unclip); document.getElementById(t.dataset.unclip).classList.remove("clip"); t.remove(); }
  else if (t.dataset.filter) { state.filter=t.dataset.filter; renderCases(); }
  else if (t.hasAttribute("data-clear-filters")) { state.filter="all"; state.query=""; $("#case-search").value=""; renderCases(); }
  else if (t.dataset.ledgerTab) {
    state.ledgerTab=t.dataset.ledgerTab;
    document.querySelectorAll("[data-ledger-tab]").forEach(b=>b.setAttribute("aria-pressed",String(b===t)));
    $("#invoice-pane").hidden=state.ledgerTab!=="invoices"; $("#payment-pane").hidden=state.ledgerTab!=="payments";
  } else if (t.hasAttribute("data-resolved")) { state.showResolved=!state.showResolved; renderApprovals(); }
  else if (t.dataset.approve) openDialog("approve",t.dataset.approve);
  else if (t.dataset.reject) openDialog("reject",t.dataset.reject);
  else if (t.dataset.export) exportEvidence(t.dataset.export);
  else if (t.id==="btn-reset") openDialog("reset");
  else if (t.id==="btn-policy" || t.id==="btn-policy-status") openDialog("policy");
  else if (t.id==="btn-theme") setTheme(document.documentElement.dataset.theme==="dark" ? "light" : "dark");
  else if (t.hasAttribute("data-close-dialog")) $("#action-dialog").close();
  else if (t.hasAttribute("data-retry")) await boot();
});
$("#case-search").addEventListener("input",e=>{state.query=e.target.value.trim().toLowerCase();renderCases();});
document.addEventListener("keydown",e=>{
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat || $("#action-dialog").open) return;
  if (e.target.closest("button,a,input,textarea,select,summary,[contenteditable]")) return;
  if (/^[1-4]$/.test(e.key)) { e.preventDefault(); state.selected=Number(e.key)-1; renderRunbook(); }
  if (e.key==="Enter") { e.preventDefault(); runScenario(RUNBOOK[state.selected]); }
});
function toast(text,detail) {
  const box=$("#toasts"); while (box.children.length>=3) box.firstChild.remove();
  const el=document.createElement("div"); el.className="toast";
  el.innerHTML='<div class="t">'+esc(text)+'</div>'+(detail ? '<div class="d">'+esc(detail)+'</div>' : ""); box.appendChild(el);
  setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),160);},5000);
}
try { setTheme(localStorage.getItem("payeelock-theme")==="dark" ? "dark" : "light"); } catch { setTheme("light"); }
boot();
