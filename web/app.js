/* PayeeLock console. Plain DOM. State from /api/state, then /api/events (SSE). */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => "$" + Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mask = (acct) => (acct ? "••••" + String(acct).replace(/[^0-9]/g, "").slice(-4) : "?");
const bank = (b) => (b && (b.routing || b.account) ? `${b.routing ?? "?"} ${mask(b.account)}` : "on file");
const hhmm = (d) => new Date(d).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
const hhmmss = (d) => new Date(d).toLocaleTimeString("en-US", { hour12: false });
const ms = (n) => (n == null ? "" : n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`);
const STAMP = { EXECUTED: "Executed", BLOCKED: "Blocked", PENDING_APPROVAL: "Held", NO_ACTION: "No action" };
const CHEV = `<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>`;

const state = {
  ledger: null, inboxes: {}, scenarios: {}, sandbox: null, agentMode: "",
  cases: new Map(), order: [], sent: new Map(), selected: 0, expanded: new Set(), openRows: new Set(),
};

const RUNBOOK = ["legit", "attack", "bankchange", "pay0913"];

// ---------- boot ----------

async function boot() {
  const s = await (await fetch("/api/state")).json();
  Object.assign(state, { ledger: s.ledger, inboxes: s.inboxes, scenarios: s.scenarios, sandbox: s.sandbox, agentMode: s.agentMode });
  $("#ap-inbox").textContent = s.inboxes.ap;
  $("#st-agent").textContent = `agent ${s.agentMode}`;
  for (const ev of s.events) applyEvent(ev, true);
  if (state.order.length) state.expanded.add(state.order[0]);
  renderAll();
  tickClock();
  setInterval(tickClock, 15000);
  const es = new EventSource("/api/events");
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "hello") return setSys("mail", "listening", "on");
    applyEvent(ev, false);
    renderAll();
  };
  es.onerror = () => setSys("mail", "disconnected", "bad");
}

function tickClock() { $("#clock").textContent = hhmm(Date.now()); }
function setSys(which, text, cls) {
  $(`#st-${which}`).textContent = which === "agent" ? `agent ${text}` : text;
  $(`#dot-${which}`).className = `dot ${cls}`;
}

// ---------- events ----------

function caseFor(id) {
  let c = state.cases.get(id);
  if (!c) {
    c = { id, n: state.cases.size + 1, at: {}, decisions: [] };
    state.cases.set(id, c);
    state.order.unshift(id);
  }
  return c;
}

function applyEvent(ev, replay) {
  const d = ev.data;
  switch (ev.type) {
    case "email.sent":
      state.sent.set(d.scenario, ev.at);
      break;
    case "email.received": {
      const c = caseFor(d.messageId);
      c.email = d; c.at.received = ev.at;
      if (!replay) { state.expanded.clear(); state.expanded.add(c.id); state.openRows.clear(); }
      setSys("agent", "running", "run");
      break;
    }
    case "agent.code": { const c = caseFor(d.messageId); c.code = d.code; c.mode = d.mode; c.at.code = ev.at; break; }
    case "sandbox.result": { const c = caseFor(d.messageId); c.sandbox = d; c.at.sandbox = ev.at; break; }
    case "agent.proposal": { const c = caseFor(d.messageId); c.proposals = d.proposals; c.at.proposal = ev.at; break; }
    case "ledger.decision": {
      const id = d.proposal?.source?.messageId;
      if (!id) break;
      const c = caseFor(id);
      c.decisions.push(d); c.at.decision = ev.at;
      if (!replay) { state.openRows.add(`${id}:5`); if (d.status === "BLOCKED") state.openRows.add(`${id}:3`); }
      break;
    }
    case "email.replied": { const c = caseFor(d.messageId); c.reply = d; c.at.reply = ev.at; setSys("agent", state.agentMode, ""); break; }
    case "pipeline.error": { const c = caseFor(d.messageId); c.error = d.error; setSys("agent", "error", "bad"); break; }
    case "ledger.state":
      if (replay) state.ledger = d;
      else setTimeout(() => { state.ledger = d; renderLedger(); renderApprovals(); }, 400);
      break;
    case "ledger.change":
      if (!replay) toast(`${d.status === "approved" ? "Callback confirmed" : "Change rejected"} · ${d.vendorName}`, `${d.id} · ${bank(d.proposedBank)}`);
      break;
  }
}

// ---------- render ----------

function renderAll() { renderRunbook(); renderApprovals(); renderCases(); renderLedger(); renderPolicy(); }

function scenarioState(key) {
  const s = state.scenarios[key];
  const c = [...state.cases.values()].find((x) => x.email?.subject === s.subject);
  if (c && c.decisions.length) return { cls: "done", meta: hhmm(c.at.received) };
  if (c || state.sent.has(key)) return { cls: "running", meta: "running" };
  return { cls: "", meta: "" };
}

function renderRunbook() {
  $("#runbook").innerHTML = RUNBOOK.map((key, i) => {
    const s = state.scenarios[key];
    if (!s) return "";
    const st = scenarioState(key);
    const attacker = s.from === state.inboxes.attacker;
    return `<li class="step ${st.cls} ${state.selected === i ? "active" : ""}" data-select="${i}">
      <span class="step-n">${st.cls === "done" ? "✓" : i + 1}</span>
      <span class="step-label" title="${esc(s.title)}">${esc(s.title)}</span>
      <span class="step-side">
        <span class="step-meta mono">${esc(st.meta)}</span>
        <span class="step-actions">
          <button class="btn btn-primary btn-sm" data-send="${key}">Send</button>
          <button class="btn btn-ghost btn-sm" data-run="${key}" title="Process without the email round trip">Offline</button>
        </span>
      </span>
      <span class="step-from mono ${attacker ? "attacker" : ""}" style="font-size:11px;color:${attacker ? "" : "var(--text-4)"}">${esc(s.from)}${attacker ? " · look-alike" : ""}</span>
    </li>`;
  }).join("");
}

function renderApprovals() {
  const changes = (state.ledger?.pendingChanges ?? []).slice().reverse();
  const pending = changes.filter((c) => c.status === "pending").length;
  $("#approvals-count").textContent = pending ? String(pending) : "";
  const el = $("#approvals");
  if (!changes.length) { el.innerHTML = `<div class="empty">No approvals waiting.</div>`; return; }
  el.innerHTML = changes.map((c) => {
    const attacker = c.source?.from === state.inboxes.attacker;
    const age = Math.max(0, Math.round((Date.now() - new Date(c.requestedAt)) / 60000));
    return `<div class="approval ${c.status === "pending" ? "" : "settled"}">
      <div class="approval-row1"><span>${esc(c.vendorName)}</span><span class="stamp stamp-${c.status === "pending" ? "PENDING_APPROVAL" : c.status === "approved" ? "EXECUTED" : "BLOCKED"}">${c.status === "pending" ? "Held" : c.status}</span></div>
      <div class="approval-row2 mono"><span>${esc(bank(c.currentBank))} <span class="arrow">→</span> ${esc(bank(c.proposedBank))}</span><span class="by ${attacker ? "attacker" : ""}">${esc(c.source?.from)}</span><span>${age}m</span></div>
      ${c.status === "pending"
        ? `<div class="approval-actions"><button class="btn btn-sm" data-approve="${c.id}">Confirm callback <kbd>⏎</kbd></button><button class="btn btn-ghost btn-sm" data-reject="${c.id}">Reject</button></div>`
        : `<div class="approval-result">${esc(c.approver)} · ${esc(c.method ?? c.reason ?? "")}</div>`}
    </div>`;
  }).join("");
}

function renderCases() {
  const el = $("#cases");
  const cases = state.order.map((id) => state.cases.get(id));
  $("#case-count").textContent = cases.length ? `${cases.length}` : "";
  if (!cases.length) { el.innerHTML = `<div class="empty">No inbound email yet. Send step 1 from the runbook.</div>`; return; }
  el.innerHTML = cases.map(renderCase).join("");
}

function outcomeOf(c) {
  if (c.error) return "BLOCKED";
  if (!c.decisions.length) return null;
  if (c.decisions.some((d) => d.status === "BLOCKED")) return "BLOCKED";
  if (c.decisions.some((d) => d.status === "PENDING_APPROVAL")) return "PENDING_APPROVAL";
  if (c.decisions.some((d) => d.status === "EXECUTED")) return "EXECUTED";
  return "NO_ACTION";
}

function renderCase(c) {
  const open = state.expanded.has(c.id);
  const outcome = outcomeOf(c);
  const dotCls = outcome === "EXECUTED" ? "on" : outcome === "BLOCKED" ? "bad" : outcome === "PENDING_APPROVAL" ? "warn" : c.email ? "run" : "";
  const attacker = c.email?.from?.includes(state.inboxes.attacker);
  const total = c.at.received && c.at.decision ? new Date(c.at.decision) - new Date(c.at.received) : null;
  const stamps = c.decisions.length ? c.decisions.map((d) => `<span class="stamp stamp-${d.status}">${STAMP[d.status]}</span>`).join(" ") : "";
  return `<article class="case ${open ? "active" : "collapsed"}" data-case="${esc(c.id)}">
    <div class="case-head" data-toggle-case="${esc(c.id)}">
      <i class="dot ${dotCls}"></i>
      <span class="case-id mono">#${String(c.n).padStart(4, "0")}</span>
      <span class="case-subject">${esc(c.email?.subject ?? "…")}</span>
      <span class="case-right">${open ? "" : stamps}<span class="from mono ${attacker ? "attacker" : ""}">${esc(c.email?.from ?? "")}</span><span class="mono">${c.at.received ? hhmmss(c.at.received) : ""}</span><span class="mono">${ms(total)}</span></span>
    </div>
    <div class="case-body">
      ${rowEmail(c)}${rowCode(c)}${rowSandbox(c)}${rowProposals(c)}${rowDecision(c)}${rowReply(c)}
      ${c.error ? `<div class="row"><span></span><span class="row-name danger">${esc(c.error)}</span><span></span></div>` : ""}
    </div>
  </article>`;
}

function row(c, n, name, side, content, { pending = false, open = null } = {}) {
  const key = `${c.id}:${n}`;
  const isOpen = open ?? state.openRows.has(key);
  if (pending) return `<div class="row pending"><span></span><span class="row-name">${name}</span><span class="row-side mono">…</span></div>`;
  return `<div class="row row-head ${isOpen ? "open" : ""}" data-row="${key}">
    ${CHEV}<span class="row-name">${name}</span><span class="row-side mono">${side}</span>
    <div class="row-content"><div><div class="row-inner">${content}</div></div></div>
  </div>`;
}

function dt(a, b) { return a && b ? new Date(b) - new Date(a) : null; }

function logBlock(text, { clip = true, classify = () => "" } = {}) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  const id = "log" + Math.random().toString(36).slice(2, 8);
  const body = lines.map((l, i) => `<div class="ln ${classify(l)}"><i>${i + 1}</i><span>${esc(l) || " "}</span></div>`).join("");
  const more = clip && lines.length > 3 ? `<button class="log-more" data-unclip="${id}">Show ${lines.length - 3} more lines</button>` : "";
  return `<div class="log ${clip && lines.length > 3 ? "clip" : ""}" id="${id}">${body}</div>${more}`;
}

const emailClass = (l) => (/AP-BOT INSTRUCTION|urllib|open\(|```/.test(l) ? "inj" : /Routing number|Account number/.test(l) ? "mark" : "");
const codeClass = (l) => (/vendor-supplied|urllib|vendors\.json/.test(l) ? "inj" : "");
const stderrClass = (l) => (/Error|error|No such file|Name does not resolve|confirm failed/.test(l) ? "denied" : "");

function rowEmail(c) {
  if (!c.email) return row(c, 1, "Inbound email", "", "", { pending: true });
  return row(c, 1, `Inbound email <span class="tag">AgentMail</span>`, `${esc(c.email.from)}`, logBlock(c.email.text, { classify: emailClass }));
}

function rowCode(c) {
  if (!c.code) return row(c, 2, "Agent writes extractor", "", "", { pending: !!c.email });
  const copied = /vendor-supplied confirmation step/.test(c.code);
  return row(c, 2, `Agent writes extractor <span class="tag">${esc(c.mode)}</span>${copied ? `<span class="tag danger">copied script from email</span>` : ""}`,
    ms(dt(c.at.received, c.at.code)),
    `<div class="hint" style="margin:0 0 6px">Unhardened by design. It does what the email says. The next two rows do not depend on it.</div>${logBlock(c.code, { classify: codeClass })}`);
}

function rowSandbox(c) {
  const s = c.sandbox;
  if (!s) return row(c, 3, "Wasmer sandbox runs it", "", "", { pending: !!c.code });
  const denied = (s.denied ?? []).map((d) => `<span class="tag danger">DENIED ${d.capability === "outbound network" ? "net.connect" : d.capability === "file access" ? "fs.read" : d.capability}</span>`).join("");
  const ex = s.extraction;
  const extraction = ex
    ? `<div class="kv-grid">${Object.entries(ex).map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v ${v === null ? "null" : ""}">${esc(v === null ? "null" : v)}</div></div>`).join("")}</div>`
    : `<div class="danger" style="margin-bottom:8px">No JSON extraction produced.</div>`;
  const deniedList = s.denied?.length ? `<div class="denied-list">${s.denied.map((d) => `<div class="denied-line"><b>${d.capability === "outbound network" ? "net.connect" : d.capability === "file access" ? "fs.read" : esc(d.capability)}</b><span>${esc(d.detail)}</span></div>`).join("")}</div>` : "";
  const policy = `<div class="hint" style="margin:0 0 8px">network <b>disabled</b> · mounted <span class="mono">data/email.txt, data/invoice.txt</span> · ledger, payee file and API keys are not in the guest</div>`;
  const stderr = s.stderr?.trim() ? `<div class="label" style="margin:8px 0 4px">stderr</div>${logBlock(s.stderr, { classify: stderrClass })}` : "";
  const stdout = s.stdout?.trim() ? `<div class="label" style="margin:8px 0 4px">stdout</div>${logBlock(s.stdout, { classify: stderrClass })}` : "";
  return row(c, 3, `Wasmer sandbox runs it ${denied}`, `exit ${s.exitCode} · ${ms(s.ms)}`, `${policy}${deniedList}${extraction}${stdout}${stderr}`);
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
  return row(c, 6, `Reply sent <span class="tag">AgentMail</span>`, esc(c.reply.to), logBlock(c.reply.text));
}

// ---------- ledger ----------

function setRoll(id, text) {
  const el = $(id);
  if (el.dataset.value === text) return;
  const changed = el.dataset.value !== undefined;
  el.dataset.value = text;
  el.innerHTML = [...text].map((ch) => `<span class="${changed ? "roll" : ""}">${esc(ch)}</span>`).join("");
}

function renderLedger() {
  const L = state.ledger;
  if (!L) return;
  const stopped = L.decisions.filter((d) => d.status === "BLOCKED" && d.proposal.type === "PAY").reduce((s, d) => s + Number(d.proposal.amount || 0), 0);
  const paid = L.payments.reduce((s, p) => s + p.amount, 0);
  const held = L.pendingChanges.filter((c) => c.status === "pending").length + L.decisions.filter((d) => d.status === "PENDING_APPROVAL" && d.proposal.type === "PAY").length;
  setRoll("#m-stopped", money(stopped));
  setRoll("#m-paid", money(paid));
  setRoll("#m-held", String(held));

  $("#vendors").innerHTML = L.vendors.map((v) => {
    const changed = L.pendingChanges.some((c) => c.vendorId === v.id && c.status === "approved");
    return `<div class="payee">
      <span class="name" title="${esc(v.name)}">${esc(v.name)}</span>
      <span class="acct ${changed ? "ok" : ""}">${esc(bank(v.bank))}</span>
      <span class="sub"><span>${esc(v.id)} · ${esc(v.contacts[0])}</span><span title="${esc(v.bankVerifiedVia)}">${changed ? "re-verified by callback" : "verified"}</span></span>
    </div>`;
  }).join("");

  $("#invoices").innerHTML = `<tr><th>Invoice</th><th class="num">Amount</th><th>Status</th></tr>` + L.invoices.map((i) => `<tr>
      <td class="id">${esc(i.id)}</td><td class="num">${money(i.amount)}</td>
      <td><span class="st"><i class="dot ${i.status === "paid" ? "on" : ""}"></i>${esc(i.status)}</span></td></tr>`).join("");

  $("#payments").innerHTML = L.payments.length
    ? `<tr><th>Invoice</th><th class="num">Amount</th><th class="num">To</th></tr>` + L.payments.map((p) => `<tr><td class="id">${esc(p.invoiceId)}</td><td class="num">${money(p.amount)}</td><td class="num" title="${esc(bank(p.bank))}">${esc(mask(p.bank.account))}</td></tr>`).join("")
    : `<tr><td class="empty" style="border:0;padding:0">No payments executed.</td></tr>`;
}

function renderPolicy() {
  const s = state.sandbox;
  if (!s) return;
  $("#policy").innerHTML = `<tr><td>runtime</td><td>${esc(s.runtime)}</td></tr><tr><td>network</td><td>${esc(s.network)}</td></tr><tr><td>mounted</td><td>${esc(s.mounts.join(", "))}</td></tr><tr><td>not mounted</td><td>${esc(s.notMounted.join(", "))}</td></tr><tr><td>timeout</td><td>${s.timeoutMs} ms</td></tr>`;
}

// ---------- actions ----------

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
  return r.json();
}

async function send(key) { await post(`/api/scenario/${key}/send`); }
async function runOffline(key) { await post(`/api/scenario/${key}/run`); }
async function approve(id) { await post(`/api/changes/${id}/approve`, { approver: "Priya Natarajan, AP Manager", method: "Phone callback to number on file" }); }
async function reject(id) {
  const reason = window.prompt("Reason for rejecting this payee change", "Vendor did not request this change");
  if (reason === null) return;
  await post(`/api/changes/${id}/reject`, { approver: "Priya Natarajan, AP Manager", reason });
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-send],[data-run],[data-approve],[data-reject],[data-toggle-case],[data-row],[data-unclip],[data-select],#btn-reset");
  if (!t) return;
  try {
    if (t.dataset.send) { e.stopPropagation(); t.disabled = true; await send(t.dataset.send); }
    else if (t.dataset.run) { e.stopPropagation(); t.disabled = true; await runOffline(t.dataset.run); }
    else if (t.dataset.approve) await approve(t.dataset.approve);
    else if (t.dataset.reject) await reject(t.dataset.reject);
    else if (t.dataset.unclip) { e.stopPropagation(); $("#" + t.dataset.unclip).classList.remove("clip"); t.remove(); }
    else if (t.dataset.row) {
      if (e.target.closest(".row-content")) return;
      const k = t.dataset.row;
      state.openRows.has(k) ? state.openRows.delete(k) : state.openRows.add(k);
      t.classList.toggle("open");
    }
    else if (t.dataset.toggleCase) {
      const id = t.dataset.toggleCase;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      renderCases();
    }
    else if (t.dataset.select !== undefined) { state.selected = Number(t.dataset.select); renderRunbook(); }
    else if (t.id === "btn-reset") {
      await post("/api/reset");
      state.cases.clear(); state.order = []; state.sent.clear(); state.expanded.clear(); state.openRows.clear(); state.selected = 0;
      renderAll();
    }
  } catch (err) { toast("Action failed", err.message); if (t.disabled) t.disabled = false; }
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea") || e.metaKey || e.ctrlKey) return;
  if (/^[1-4]$/.test(e.key)) { state.selected = Number(e.key) - 1; renderRunbook(); }
  if (e.key === "Enter") { const b = $(`.step.active [data-send]`); if (b && !b.disabled) b.click(); }
});

function toast(text, detail) {
  const box = $("#toasts");
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="t">${esc(text)}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ""}`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 160); }, 4000);
}

boot();
