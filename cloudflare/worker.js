// Cloudflare Worker that fronts a single PayeeLock container instance.
// The Express server (AgentMail listener, Wasmer sandbox, ledger, console) runs unchanged inside the container.

import { Container, getContainer } from "@cloudflare/containers";

export class PayeeLockContainer extends Container {
  defaultPort = 4310;
  sleepAfter = "45m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      PORT: "4310",
      NODE_ENV: "production",
      AGENTMAIL_API_KEY: env.AGENTMAIL_API_KEY ?? "",
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
      AGENT_MODE: env.AGENT_MODE ?? "",
    };
  }

  onStart() {
    console.log("PayeeLock container started");
  }
  onError(error) {
    console.log("PayeeLock container error:", String(error));
  }
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.PAYEELOCK, "demo");
    const url = new URL(request.url);
    // Operator-only restart, used after rotating secrets so the container picks up new env vars.
    if (url.pathname === "/__restart" && url.searchParams.get("key") === (env.RESTART_KEY ?? "")) {
      await container.destroy();
      return new Response("restarting\n", { status: 202 });
    }
    return container.fetch(request);
  },
};
