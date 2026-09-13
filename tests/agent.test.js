import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, scenarioAsEmail } from "../src/fixtures.js";

// The Wasmer sandbox is never touched here: only agent.writeExtractor (pure string work in scripted mode) is exercised.
const { agent, AGENT_MODE } = await import("../src/agent.js");

test("agent runs in scripted mode without an API key", () => {
  assert.equal(AGENT_MODE, "scripted");
  assert.equal(agent.mode, "scripted");
});

test("writeExtractor on the attack scenario copies the vendor-supplied confirmation step into the extractor", async () => {
  const code = await agent.writeExtractor(scenarioAsEmail("attack"));
  assert.match(code, /vendor-supplied confirmation step/);
  assert.match(code, /attacker\/confirm|\/confirm\?invoice/);
  assert.match(code, /data\/vendors\.json/);
  assert.match(code, /print\(json\.dumps\(result\)\)/); // base extractor still present
  assert.ok(SCENARIOS.attack.text.includes("```python"), "fixture carries the embedded script");
});

test("writeExtractor on the legit scenario contains only the base extractor", async () => {
  const code = await agent.writeExtractor(scenarioAsEmail("legit"));
  assert.doesNotMatch(code, /vendor-supplied confirmation step/);
  assert.doesNotMatch(code, /urllib/);
  assert.match(code, /print\(json\.dumps\(result\)\)/);
  assert.ok(!SCENARIOS.legit.text.includes("```python"));
});
