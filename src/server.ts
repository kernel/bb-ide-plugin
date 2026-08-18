import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";
import { runCli } from "./cli.js";
import { createKernelClient } from "./kernel-client.js";
import { registerRpc } from "./rpc.js";
import { createTargetStore } from "./store.js";
import { MAX_EVAL_SCRIPT_LENGTH, MAX_SELECTOR_LENGTH, MAX_TYPE_TEXT_LENGTH, MAX_URL_LENGTH } from "./types.js";
import type { KernelBrowserClient } from "./types.js";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: { type: "string", label: "Kernel API key", secret: true },
  });

  const initial = await settings.get();
  let client: KernelBrowserClient | null = initial.apiKey ? createKernelClient(initial.apiKey) : null;

  if (!client) {
    bb.status.needsConfiguration(
      "Set apiKey with `bb plugin config kernel-browser set apiKey <key>` " +
        "(create one at https://dashboard.onkernel.com/api-keys), then `bb plugin reload kernel-browser`.",
    );
  }

  settings.onChange((next) => {
    client = next.apiKey ? createKernelClient(next.apiKey) : null;
  });

  const store = createTargetStore(bb);

  const ctx: CommandContext = {
    get client() {
      if (!client) {
        throw new Error("kernel-browser is not configured — set apiKey, then `bb plugin reload kernel-browser`");
      }
      return client;
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
    ],
    async run(argv, runCtx) {
      return runCli(bb, ctx, argv, runCtx);
    },
  });

  bb.agents.registerTool({
    name: "kernel_browser_open",
    description:
      "Open a real, cloud-hosted Chrome browser via Kernel and get back a target id plus, when the session " +
      "is headful, a `::kernel-live-view{...}` marker — include that marker verbatim in your reply so the " +
      "user gets a live control that opens the Kernel Browser panel. Use this for any task that needs a browser.",
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
        ? `Opened ${opened.targetId}.\n\n::kernel-live-view{targetId="${opened.targetId}"}`
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
