import { ensureInboxes } from "./mail.js";

const inboxes = await ensureInboxes();
console.log("AgentMail inboxes ready:");
for (const i of inboxes) console.log(`  ${i.inboxId}  (${i.displayName})`);
