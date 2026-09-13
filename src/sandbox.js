// Wasmer-backed execution boundary for agent-generated code.
// The generated extractor sees exactly two files and has no network. The ledger is never mounted.

import { Wasmer } from "@wasmer/sdk/node";

let wasmer;
export function getWasmer() {
  return (wasmer ??= new Wasmer());
}

export const SANDBOX_POLICY = {
  runtime: "Wasmer SDK 0.13 (WASIX), python/python package",
  network: "disabled",
  mounts: ["data/email.txt", "data/invoice.txt", "work/extract.py"],
  notMounted: ["data/vendors.json (approved payees)", ".state/ledger.json", "AgentMail API key", "host filesystem"],
  timeoutMs: 20000,
};

/**
 * Run a generated Python extractor against the email and invoice text.
 * Returns stdout/stderr, the parsed JSON extraction (last JSON line of stdout), and any denied capabilities.
 */
export async function runExtractor({ code, emailText, invoiceText = "", unsafe = false, extraFiles = {} }) {
  const files = { "work/extract.py": code, "data/email.txt": emailText, "data/invoice.txt": invoiceText, ...(unsafe ? extraFiles : {}) };
  const network = unsafe ? "host" : "disabled";
  const t0 = Date.now();
  const sandbox = await getWasmer().sandboxes.create({
    packages: ["python/python"],
    network: { mode: network },
    files,
  });
  let out;
  try {
    out = await sandbox.command("python", ["work/extract.py"]).run({ check: false, timeoutMs: SANDBOX_POLICY.timeoutMs });
  } finally {
    await sandbox.close();
  }
  const stdout = out.stdout.text();
  const stderr = out.stderr.text();
  return {
    exitCode: out.exitCode,
    reason: out.reason,
    ms: Date.now() - t0,
    stdout,
    stderr,
    extraction: lastJsonLine(stdout),
    denied: unsafe ? [] : classifyDenials(stdout + "\n" + stderr),
    unsafe,
    policy: { ...SANDBOX_POLICY, network, mounts: Object.keys(files) },
  };
}

function lastJsonLine(s) {
  const lines = s.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object") return v;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function classifyDenials(stderr) {
  const denied = [];
  if (/Name does not resolve|URLError|urlopen error|gaierror|Network is unreachable|Connection refused|ECONNREFUSED|ENOTCONN|EHOSTUNREACH|ENETUNREACH/i.test(stderr)) {
    denied.push({ capability: "outbound network", detail: "sandbox network policy is disabled; DNS and TCP are unavailable to the guest" });
  }
  const nf = stderr.match(/No such file or directory: '([^']+)'/);
  if (nf) denied.push({ capability: "file access", detail: `${nf[1]} is not mounted in the sandbox` });
  if (/PermissionError/i.test(stderr)) denied.push({ capability: "file write", detail: "write outside the workspace denied" });
  return denied;
}

export async function shutdownSandboxes() {
  if (wasmer) {
    await wasmer.shutdown();
    wasmer = undefined;
  }
}
