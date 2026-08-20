import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";
import { runCli } from "./cli.js";
import { createKernelClient } from "./kernel-client.js";
import { createKernelAuthClient } from "./kernel-auth-client.js";
import { registerRpc } from "./rpc.js";
import { createTargetStore } from "./store.js";
import {
  DEFAULT_AUTH_WAIT_SECONDS,
  MAX_ALLOWED_DOMAINS,
  MAX_AUTH_WAIT_SECONDS,
  MAX_DOMAIN_LENGTH,
  MAX_EVAL_SCRIPT_LENGTH,
  MAX_LOGIN_URL_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_SELECTOR_LENGTH,
  MAX_TYPE_TEXT_LENGTH,
  MAX_URL_LENGTH,
} from "./types.js";
import type { KernelAuthClient, KernelBrowserClient } from "./types.js";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "Kernel API key", secret: true },
  });

  const initial = await settings.get();
  let client: KernelBrowserClient | null = initial.apiKey ? createKernelClient(initial.apiKey) : null;
  let authClient: KernelAuthClient | null = initial.apiKey ? createKernelAuthClient(initial.apiKey) : null;

  if (!client) {
    bb.status.needsConfiguration(
      "Set apiKey with `bb plugin config kernel-browser set apiKey <key>` " +
        "(create one at https://dashboard.onkernel.com/api-keys), then `bb plugin reload kernel-browser`.",
    );
  }

  settings.onChange((next) => {
    client = next.apiKey ? createKernelClient(next.apiKey) : null;
    authClient = next.apiKey ? createKernelAuthClient(next.apiKey) : null;
  });

  const store = createTargetStore(bb);

  const ctx: CommandContext = {
    get client() {
      if (!client) {
        throw new Error("kernel-browser is not configured — set apiKey, then `bb plugin reload kernel-browser`");
      }
      return client;
    },
    get authClient() {
      if (!authClient) {
        throw new Error("kernel-browser is not configured — set apiKey, then `bb plugin reload kernel-browser`");
      }
      return authClient;
    },
    store,
    notify(threadId, event, targetId) {
      if (threadId) bb.realtime.publish(`kernel-browser:${threadId}`, { event, targetId });
    },
  };

  registerRpc(bb, ctx);

  bb.cli.register({
    name: "kernel-browser",
    summary: "Open, drive, and watch Kernel cloud browsers",
    commands: [
      {
        name: "open",
        summary: "Open a Kernel browser",
        usage: "bb kernel-browser open [url] [--stealth] [--headless] [--profile <name>] [--timeout <seconds>] [--json]",
      },
      { name: "list", summary: "List open targets", usage: "bb kernel-browser list [--json]" },
      {
        name: "snapshot",
        summary: "Read a target's current url and title",
        usage: "bb kernel-browser snapshot <target-id> [--json]",
      },
      {
        name: "click",
        summary: "Click a selector or a coordinate",
        usage: "bb kernel-browser click <target-id> --selector <css> | --x <n> --y <n>",
      },
      {
        name: "type",
        summary: "Type text into a selector, or the focused element",
        usage: "bb kernel-browser type <target-id> --text <text> [--selector <css>]",
      },
      {
        name: "eval",
        summary: "Run a small Playwright script against a target",
        usage: "bb kernel-browser eval <target-id> --script <code> | --script-file <path> [--json]",
      },
      {
        name: "close",
        summary: "Close a target and delete its Kernel session",
        usage: "bb kernel-browser close <target-id>",
      },
      {
        name: "replay-start",
        summary: "Start recording a video replay of a target",
        usage: "bb kernel-browser replay-start <target-id> [--framerate <fps>] [--max-duration <seconds>] [--audio] [--json]",
      },
      {
        name: "replay-stop",
        summary: "Stop a replay recording and persist the video",
        usage: "bb kernel-browser replay-stop <target-id> --replay-id <id> [--json]",
      },
      {
        name: "replay-list",
        summary: "List replay recordings for a target",
        usage: "bb kernel-browser replay-list <target-id> [--json]",
      },
      {
        name: "auth-create",
        summary: "Create a managed auth connection for a profile and domain",
        usage: "bb kernel-browser auth-create <domain> --profile <name> [--login-url <url>] [--allowed-domains <a.com,b.com>] [--json]",
      },
      {
        name: "auth-list",
        summary: "List managed auth connections",
        usage: "bb kernel-browser auth-list [--domain <domain>] [--profile <name>] [--json]",
      },
      {
        name: "auth-get",
        summary: "Get a managed auth connection's current status",
        usage: "bb kernel-browser auth-get <connection-id> [--json]",
      },
      {
        name: "auth-login",
        summary: "Start a hosted login (or automatic re-auth) flow",
        usage: "bb kernel-browser auth-login <connection-id> [--json]",
      },
      {
        name: "auth-wait",
        summary: "Wait for a login flow to finish",
        usage: "bb kernel-browser auth-wait <connection-id> [--timeout <seconds>] [--json]",
      },
      {
        name: "auth-delete",
        summary: "Delete a managed auth connection",
        usage: "bb kernel-browser auth-delete <connection-id>",
      },
    ],
    async run(argv, runCtx) {
      return runCli(bb, ctx, argv, runCtx);
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_open",
    description:
      "Open a real, cloud-hosted Chrome browser via Kernel and get back a target id plus a live view URL " +
      "the user can watch. Use this for any task that needs a browser.",
    instructions:
      "If a person is likely watching this task (not a background/batch job looping over many targets), " +
      "include `::kernel-live{target-id=\"<target-id>\"}` on its own line in your reply so they see the live " +
      "view embedded inline instead of just a link. Skip it for unattended or bulk opens, and include at most " +
      "one per reply — pick the target most relevant to what's being discussed.",
    experimental_statusLabels: { pending: "Opening a Kernel browser", completed: "Opened a Kernel browser" },
    parameters: z.object({
      url: z.string().max(MAX_URL_LENGTH).optional().describe("URL to navigate to on open"),
      stealth: z.boolean().optional().describe("Use Kernel's anti-bot-detection stealth mode"),
    }),
    async execute({ url, stealth }, { threadId }) {
      const opened = await commands.openTarget(ctx, {
        url,
        stealth,
        threadId,
        createdBy: "agent",
      });
      return opened.liveViewUrl
        ? `Opened ${opened.targetId}. Live view: ${opened.liveViewUrl}`
        : `Opened ${opened.targetId} (headless — no live view).`;
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_snapshot",
    description: "Read the current URL and title of an open Kernel browser target.",
    parameters: z.object({ targetId: z.string() }),
    async execute({ targetId }) {
      const snapshot = await commands.snapshotTarget(ctx, targetId);
      return `${snapshot.title}\n${snapshot.url}`;
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_click",
    description: "Click a CSS selector (preferred) or an x/y coordinate in an open Kernel browser target.",
    parameters: z.object({
      targetId: z.string(),
      selector: z.string().max(MAX_SELECTOR_LENGTH).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    async execute({ targetId, selector, x, y }) {
      await commands.clickTarget(ctx, targetId, { selector, x, y });
      return "clicked";
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_type",
    description: "Type text into a CSS selector, or the focused element, in an open Kernel browser target.",
    parameters: z.object({
      targetId: z.string(),
      text: z.string().max(MAX_TYPE_TEXT_LENGTH),
      selector: z.string().max(MAX_SELECTOR_LENGTH).optional(),
    }),
    async execute({ targetId, text, selector }) {
      await commands.typeIntoTarget(ctx, targetId, { selector, text });
      return "typed";
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_eval",
    description:
      "Run a short Playwright script (with `page` in scope) against an open Kernel browser target and return " +
      "its result. Keep scripts small and explicit — prefer selector-based clicks/types over eval when possible.",
    parameters: z.object({
      targetId: z.string(),
      script: z.string().max(MAX_EVAL_SCRIPT_LENGTH),
    }),
    async execute({ targetId, script }) {
      const result = await commands.evaluateInTarget(ctx, targetId, script);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_close",
    description: "Close an open Kernel browser target and delete its cloud session.",
    parameters: z.object({ targetId: z.string() }),
    async execute({ targetId }) {
      await commands.closeTarget(ctx, targetId);
      return "closed";
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_replay_start",
    description:
      "Start recording a video replay of an open Kernel browser target and return a replay id. Call " +
      "kernel_browser_replay_stop to persist the video once the recorded activity is done.",
    parameters: z.object({
      targetId: z.string(),
      framerate: z.number().optional().describe("Recording framerate in fps; values above 20 require GPU"),
      maxDurationSeconds: z.number().optional().describe("Maximum recording duration in seconds"),
      recordAudio: z.boolean().optional().describe("Record audio in addition to video (default: video-only)"),
    }),
    async execute({ targetId, framerate, maxDurationSeconds, recordAudio }) {
      const replay = await commands.startReplay(ctx, targetId, { framerate, maxDurationSeconds, recordAudio });
      return `Started replay ${replay.replayId}`;
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_replay_stop",
    description: "Stop an in-progress replay recording on a Kernel browser target and persist the finished video.",
    instructions:
      "If this recording is something the user asked to see or would want to review (not an internal audit " +
      "trail for a background/bulk task), include " +
      "`::kernel-replay{target-id=\"<target-id>\" replay-id=\"<replay-id>\"}` on its own line in your reply so " +
      "they see it embedded inline once it finishes processing. Skip it for unattended or bulk stops, and " +
      "include at most one per reply.",
    parameters: z.object({ targetId: z.string(), replayId: z.string() }),
    async execute({ targetId, replayId }) {
      await commands.stopReplay(ctx, targetId, replayId);
      return "stopped";
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_replay_list",
    description:
      "List video replay recordings for an open Kernel browser target, including view URLs once finished.",
    parameters: z.object({ targetId: z.string() }),
    async execute({ targetId }) {
      const replays = await commands.listReplays(ctx, targetId);
      return replays.length
        ? replays.map((r) => `${r.replayId}: ${r.replayViewUrl ?? "processing"}`).join("\n")
        : "no replays";
    },
  });

  function authStatusText(connection: {
    connectionId: string;
    domain: string;
    profileName: string;
    status: string;
    flowType: string | null;
    flowStatus: string | null;
  }): string {
    const flow = connection.flowStatus ? ` (${connection.flowType ?? "?"} flow: ${connection.flowStatus})` : "";
    return `${connection.connectionId}  ${connection.domain}  profile=${connection.profileName}  status=${connection.status}${flow}`;
  }

  bb.agents.registerTool({
    name: "kernel_auth_create",
    description:
      "Create a Kernel managed auth connection for a profile and domain. Creates the profile if it doesn't " +
      "exist yet. Call kernel_auth_list first — reuse an AUTHENTICATED connection instead of creating a new one.",
    parameters: z.object({
      domain: z.string().max(MAX_DOMAIN_LENGTH).describe("Target domain, e.g. 'netflix.com'"),
      profileName: z.string().max(MAX_PROFILE_NAME_LENGTH),
      loginUrl: z.string().max(MAX_LOGIN_URL_LENGTH).optional().describe("Login page URL to skip discovery"),
      allowedDomains: z
        .array(z.string())
        .max(MAX_ALLOWED_DOMAINS)
        .optional()
        .describe("Additional domains valid for this auth flow, e.g. redirect-based SSO domains"),
    }),
    async execute({ domain, profileName, loginUrl, allowedDomains }) {
      const connection = await commands.createAuthConnection(ctx, { domain, profileName, loginUrl, allowedDomains });
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_list",
    description: "List Kernel managed auth connections, optionally filtered by domain and/or profile name.",
    parameters: z.object({
      domain: z.string().max(MAX_DOMAIN_LENGTH).optional(),
      profileName: z.string().max(MAX_PROFILE_NAME_LENGTH).optional(),
    }),
    async execute({ domain, profileName }) {
      const connections = await commands.listAuthConnections(ctx, { domain, profileName });
      return connections.length ? connections.map(authStatusText).join("\n") : "no auth connections";
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_get",
    description: "Get a Kernel managed auth connection's current status and in-progress flow state, if any.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      const connection = await commands.getAuthConnection(ctx, connectionId);
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_login",
    description:
      "Start a login flow for a Kernel managed auth connection. Returns a hosted login URL for the user to " +
      "complete authentication themselves (Kernel's hosted UI collects the credentials, not this tool), or " +
      "triggers an automatic re-auth if credentials were already captured from a prior login.",
    instructions:
      "Put `::kernel-auth-login{connection-id=\"<connection-id>\"}` on its own line in your reply so the " +
      "hosted login page renders inline and the person can enter their own credentials there — never ask for " +
      "a password or code in chat, and never type one in yourself. Then call kernel_auth_wait for the same " +
      "connection to block until the flow finishes before continuing.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      const result = await commands.loginAuthConnection(ctx, connectionId);
      return result.hostedUrl
        ? `Started ${result.flowType} flow for ${result.connectionId}. Hosted login: ${result.hostedUrl}`
        : `Started ${result.flowType} flow for ${result.connectionId} (automatic re-auth in progress).`;
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_wait",
    description:
      "Block until a Kernel managed auth connection's in-progress login flow reaches a terminal state " +
      "(success, failure, expiry, or cancellation), or until the timeout elapses.",
    parameters: z.object({
      connectionId: z.string(),
      timeoutSeconds: z
        .number()
        .min(1)
        .max(MAX_AUTH_WAIT_SECONDS)
        .optional()
        .describe(`Seconds to wait, up to ${MAX_AUTH_WAIT_SECONDS} (default ${DEFAULT_AUTH_WAIT_SECONDS})`),
    }),
    async execute({ connectionId, timeoutSeconds }) {
      const connection = await commands.waitForAuthConnection(ctx, connectionId, timeoutSeconds);
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_delete",
    description: "Delete a Kernel managed auth connection and cancel any in-progress login flow.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      await commands.deleteAuthConnection(ctx, connectionId);
      return "deleted";
    },
  });

  async function closeTargetsForThreadLogged(threadId: string): Promise<void> {
    const failures = await commands.closeTargetsForThread(ctx, threadId);
    for (const failure of failures) {
      bb.log.warn(`failed to close target ${failure.targetId} for thread ${threadId}: ${failure.error}`);
    }
  }

  bb.events.on("thread.archived", async ({ thread }) => {
    await closeTargetsForThreadLogged(thread.id);
  });
  bb.events.on("thread.deleted", async ({ thread }) => {
    await closeTargetsForThreadLogged(thread.id);
  });
}
