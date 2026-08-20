import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";
import { runCli } from "./cli.js";
import { createKernelClient } from "./kernel-client.js";
import { createKernelAuthClient } from "./kernel-auth-client.js";
import { AUTH_CLI_COMMANDS, registerAuthTools } from "./auth-tools.js";
import { registerRpc } from "./rpc.js";
import { createTargetStore } from "./store.js";
import { MAX_EVAL_SCRIPT_LENGTH, MAX_SELECTOR_LENGTH, MAX_TYPE_TEXT_LENGTH, MAX_URL_LENGTH } from "./types.js";
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
      ...AUTH_CLI_COMMANDS,
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

  registerAuthTools(bb, ctx);

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
