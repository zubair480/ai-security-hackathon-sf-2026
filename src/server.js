// PayeeLock live server: AgentMail inbox listener + dashboard + JSON API.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger } from "./ledger.js";
import { processEmail, composeReply } from "./pipeline.js";
import { agent } from "./agent.js";
import { SANDBOX_POLICY } from "./sandbox.js";
import { INBOXES, SCENARIOS, scenarioAsEmail } from "./fixtures.js";
import { listen, sendScenario, replyTo, ensureInboxes } from "./mail.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4310);
const ledger = new Ledger();
const events = [];
const clients = new Set();
const processed = new Set();
let queue = Promise.resolve();
let mailStatus = process.env.AGENTMAIL_API_KEY ? "connecting" : "disabled";

function updateMailStatus(status) {
  mailStatus = status;
  emit("system.mail", { status });
}

function emit(type, data) {
  const ev = { seq: events.length + 1, at: new Date().toISOString(), type, data };
  events.push(ev);
  if (events.length > 500) events.shift();
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
  const brief = type === "ledger.decision" ? `${data.status} ${data.summary}` : type === "sandbox.result" ? `exit ${data.exitCode} denied=${data.denied.map((d) => d.capability).join(",") || "none"}` : data.subject ?? "";
  console.log(`[${type}] ${brief}`);
}

let currentCaseId = null; // case being processed, so attacker-endpoint hits can be attributed
const pendingUnsafe = new Set(); // subjects sent live with the sandbox removed, matched on inbound

function handleInbound(email, { reply = true, unsafe = false } = {}) {
  if (processed.has(email.messageId)) return;
  processed.add(email.messageId);
  queue = queue
    .then(async () => {
      currentCaseId = email.messageId;
      const { decisions } = await processEmail(email, { ledger, emit, unsafe }).finally(() => {
        currentCaseId = null;
      });
      if (reply && decisions.length && !email.messageId.startsWith("offline-")) {
        const text = composeReply(decisions);
        const sent = await replyTo(email, text);
        emit("email.replied", { messageId: email.messageId, replyId: sent.messageId, to: email.from, text });
      }
      emit("ledger.state", ledger.snapshot());
    })
    .catch((err) => {
      console.error("pipeline failed:", err);
      emit("pipeline.error", { messageId: email.messageId, error: err.message });
    });
  return queue;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(here, "..", "web")));

app.get("/api/state", (req, res) => {
  res.json({ ledger: ledger.snapshot(), events, inboxes: INBOXES, agentMode: agent.mode, mailStatus, sandbox: SANDBOX_POLICY, scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, { title: s.title, from: INBOXES[s.from], subject: s.subject }])) });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify({ type: "hello", data: { agentMode: agent.mode, mailStatus } })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

// Send a scenario email through AgentMail; the websocket listener picks it up.
app.post("/api/scenario/:name/send", async (req, res) => {
  try {
    const unsafe = req.body?.sandbox === "off";
    const sent = await sendScenario(req.params.name);
    // Remember the subject so the matching inbound email is processed with the sandbox removed.
    if (unsafe) pendingUnsafe.add(sent.subject);
    emit("email.sent", { ...sent, scenario: req.params.name, unsafe });
    res.json({ ...sent, unsafe });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Process a scenario offline (no email round trip). Body { sandbox: "off" } runs the comparison
// with the Wasmer boundary removed (network open, payee file mounted).
app.post("/api/scenario/:name/run", async (req, res) => {
  try {
    const unsafe = req.body?.sandbox === "off";
    const email = scenarioAsEmail(req.params.name);
    if (unsafe) email.messageId = email.messageId.replace("offline-", "offline-unsafe-");
    await handleInbound(email, { reply: false, unsafe });
    res.json({ ok: true, unsafe });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// The attacker's collection endpoint. Anything that reaches it did so because no boundary stopped it.
app.all("/attacker/:what", express.raw({ type: () => true, limit: "2mb" }), (req, res) => {
  const bytes = Buffer.isBuffer(req.body) ? req.body.length : 0;
  const preview = bytes ? req.body.toString("utf8", 0, Math.min(bytes, 400)) : "";
  const hit = { messageId: currentCaseId, path: `/attacker/${req.params.what}`, method: req.method, query: req.query, bytes, preview, at: new Date().toISOString() };
  emit("attacker.received", hit);
  console.log(`[attacker] ${req.method} ${hit.path} ${bytes} bytes (case ${currentCaseId ?? "unknown"})`);
  res.json({ ok: true });
});

app.post("/api/changes/:id/approve", (req, res) => {
  try {
    const change = ledger.approveChange(req.params.id, { approver: req.body?.approver ?? "AP Manager", method: req.body?.method ?? "Phone callback to number on file" });
    emit("ledger.change", change);
    emit("ledger.state", ledger.snapshot());
    res.json(change);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/changes/:id/reject", (req, res) => {
  try {
    const change = ledger.rejectChange(req.params.id, { approver: req.body?.approver ?? "AP Manager", reason: req.body?.reason ?? "Callback failed" });
    emit("ledger.change", change);
    emit("ledger.state", ledger.snapshot());
    res.json(change);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/reset", (req, res) => {
  ledger.reset();
  events.length = 0;
  emit("ledger.reset", {});
  emit("ledger.state", ledger.snapshot());
  res.json({ ok: true });
});

app.listen(PORT, async () => {
  console.log(`PayeeLock dashboard: http://localhost:${PORT}  (agent mode: ${agent.mode})`);
  if (!process.env.AGENTMAIL_API_KEY) {
    console.log("AGENTMAIL_API_KEY not set: email listener disabled, offline runs only.");
    return;
  }
  try {
    const inboxes = await ensureInboxes();
    console.log("inboxes:", inboxes.map((i) => `${i.inboxId} (${i.displayName})`).join(", "));
    const socket = await listen((email) => {
      const unsafe = pendingUnsafe.delete(email.subject);
      console.log(`[mail] inbound ${email.messageId} from ${email.fromRaw}: ${email.subject}${unsafe ? " [sandbox off]" : ""}`);
      handleInbound(email, { unsafe });
    });
    updateMailStatus("connected");
    socket.on("close", () => updateMailStatus("disconnected"));
    socket.on("error", () => updateMailStatus("error"));
    socket.on("open", () => updateMailStatus("connected"));
    console.log(`[mail] listening on ${INBOXES.ap}`);
  } catch (err) {
    updateMailStatus("error");
    console.error("AgentMail setup failed:", err.message);
  }
});
