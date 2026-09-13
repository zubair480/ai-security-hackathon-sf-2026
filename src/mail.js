// AgentMail helpers: inbox setup, scenario sending, replies, and inbound normalization.

import "dotenv/config";
import { AgentMailClient } from "agentmail";
import { INBOXES, SCENARIOS } from "./fixtures.js";

export const mail = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });

const usernameOf = (addr) => addr.split("@")[0];

export async function ensureInboxes() {
  const existing = new Set((await mail.inboxes.list({ limit: 50 })).inboxes.map((i) => i.inboxId));
  const wanted = [
    { id: INBOXES.ap, displayName: "PayeeLock AP Agent" },
    { id: INBOXES.vendor, displayName: "Northwind Billing" },
  ];
  for (const w of wanted) {
    if (!existing.has(w.id)) {
      await mail.inboxes.create({ username: usernameOf(w.id), displayName: w.displayName, clientId: `payeelock-${usernameOf(w.id)}-v1` });
      console.log("created inbox", w.id);
    }
  }
  // The look-alike attacker sender: same display name as the real vendor, different address.
  try {
    await mail.inboxes.update(INBOXES.attacker, { displayName: "Northwind Billing" });
  } catch (err) {
    console.warn("could not rename attacker inbox:", err.message);
  }
  return (await mail.inboxes.list({ limit: 50 })).inboxes.map((i) => ({ inboxId: i.inboxId, displayName: i.displayName }));
}

export async function sendScenario(name) {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario ${name}`);
  const from = INBOXES[s.from];
  const res = await mail.inboxes.messages.send(from, {
    to: INBOXES.ap,
    subject: s.subject,
    text: s.text,
    labels: ["payeelock-demo", name],
  });
  return { from, to: INBOXES.ap, messageId: res.messageId, subject: s.subject };
}

export async function replyTo(email, text) {
  return mail.inboxes.messages.reply(INBOXES.ap, email.messageId, { text });
}

export function parseAddress(raw) {
  const m = String(raw ?? "").match(/<([^>]+)>/);
  return (m ? m[1] : String(raw ?? "")).trim().toLowerCase();
}

export function normalizeInbound(msg) {
  return {
    messageId: msg.messageId,
    threadId: msg.threadId,
    from: parseAddress(msg.from),
    fromRaw: msg.from,
    subject: msg.subject ?? "",
    text: msg.extractedText || msg.text || "",
    receivedAt: msg.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Subscribe to inbound mail on the AP inbox. onMessage receives a normalized email.
 * Two delivery paths run at once: the websocket (fast) and a poll of the inbox every
 * `pollMs` (safety net for silent socket drops). The server dedups by message id.
 */
export async function listen(onMessage, { pollMs = 15000 } = {}) {
  const startedAt = Date.now() - 5000;
  const seen = new Set();
  const deliver = (msg, via) => {
    if (!msg?.messageId || seen.has(msg.messageId)) return;
    seen.add(msg.messageId);
    console.log(`[mail] inbound via ${via}: ${msg.subject ?? ""}`);
    onMessage(normalizeInbound(msg));
  };

  const subscribe = (socket) => socket.sendSubscribe({ type: "subscribe", inboxIds: [INBOXES.ap], eventTypes: ["message.received"] });
  const socket = await mail.websockets.connect();
  socket.on("open", () => {
    console.log("[mail] socket open, subscribing");
    try {
      subscribe(socket);
    } catch (err) {
      console.warn("[mail] subscribe on open failed:", err.message);
    }
  });
  socket.on("message", (ev) => {
    const kind = ev.type === "event" ? ev.eventType : ev.type;
    if (kind === "subscribed") {
      console.log("[mail] subscribed to", ev.inboxIds);
      return;
    }
    if (!/message[._]received$/.test(String(kind))) return;
    if (ev.message?.inboxId && ev.message.inboxId !== INBOXES.ap) return;
    deliver(ev.message, "websocket");
  });
  socket.on("close", (e) => console.log("[mail] socket closed", e?.code, e?.reason));
  socket.on("error", (e) => console.error("[mail] socket error", e?.message ?? e));
  await socket.waitForOpen();
  try {
    subscribe(socket);
  } catch {
    /* the open handler covers it */
  }

  // Poll fallback: catches anything the socket missed.
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const res = await mail.inboxes.messages.list(INBOXES.ap, { limit: 10 });
      for (const item of res.messages ?? []) {
        if (seen.has(item.messageId)) continue;
        if (new Date(item.timestamp).getTime() < startedAt) continue;
        const labels = item.labels ?? [];
        if (labels.includes("sent") || !labels.includes("received")) continue;
        const full = await mail.inboxes.messages.get(INBOXES.ap, item.messageId);
        deliver(full, "poll");
      }
    } catch (err) {
      console.warn("[mail] poll failed:", err.message);
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(poll, pollMs);
  timer.unref?.();
  socket.stopPolling = () => clearInterval(timer);
  return socket;
}
