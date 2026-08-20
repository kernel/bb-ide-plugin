import type { BbPluginApi } from "@get-bb/plugin-sdk";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";
import type { AuthConnectionSummary } from "./types.js";

interface CliRunContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
}

interface CliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

type Flags = Record<string, string | boolean>;

const BOOLEAN_FLAGS = new Set(["stealth", "headless", "json", "audio"]);

function parseArgs(args: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function requirePositional(positionals: string[], name: string): string {
  const value = positionals[0];
  if (!value) throw new Error(`missing required argument <${name}>`);
  return value;
}

function stringFlag(flags: Flags, name: string): string | undefined {
  return typeof flags[name] === "string" ? (flags[name] as string) : undefined;
}

function listFlag(flags: Flags, name: string): string[] | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatAuthConnection(connection: AuthConnectionSummary): string {
  const lines = [
    `${connection.connectionId}  ${connection.domain}  profile=${connection.profileName}  status=${connection.status}`,
  ];
  if (connection.flowStatus) {
    lines.push(`flow: ${connection.flowType ?? "?"} ${connection.flowStatus}`);
  }
  if (connection.hostedUrl) {
    lines.push(`hosted login: ${connection.hostedUrl}`);
  }
  if (connection.liveViewUrl) {
    lines.push(`live view: ${connection.liveViewUrl}`);
  }
  return lines.join("\n");
}

function ok(json: boolean, data: unknown, text: string): CliResult {
  return { exitCode: 0, stdout: json ? JSON.stringify(data, null, 2) : text };
}

function fail(message: string): CliResult {
  return { exitCode: 1, stderr: message };
}

async function resolveHostId(bb: BbPluginApi, runCtx: CliRunContext): Promise<string | undefined> {
  if (!runCtx.threadId) return undefined;
  const thread = await bb.sdk.threads.get({ threadId: runCtx.threadId });
  if (!thread.environmentId) return undefined;
  const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
  return environment.hostId;
}

async function resolveScript(bb: BbPluginApi, flags: Flags, runCtx: CliRunContext): Promise<string> {
  const inline = stringFlag(flags, "script");
  if (inline !== undefined) return inline;
  const scriptFile = stringFlag(flags, "script-file");
  if (scriptFile === undefined) {
    throw new Error("eval requires --script <code> or --script-file <path>");
  }
  const hostId = await resolveHostId(bb, runCtx);
  const file = await bb.sdk.files.read({ path: scriptFile, hostId });
  return file.content;
}

export async function runCli(
  bb: BbPluginApi,
  ctx: CommandContext,
  argv: string[],
  runCtx: CliRunContext,
): Promise<CliResult> {
  const [command, ...rest] = argv;
  const { positionals, flags } = parseArgs(rest);
  const json = flags.json === true;

  try {
    switch (command) {
      case "open": {
        const timeout = stringFlag(flags, "timeout");
        const opened = await commands.openTarget(ctx, {
          url: positionals[0],
          stealth: flags.stealth === true,
          headless: flags.headless === true,
          profileName: stringFlag(flags, "profile"),
          timeoutSeconds: timeout ? Number(timeout) : undefined,
          threadId: runCtx.threadId ?? null,
          createdBy: "cli",
        });
        const watch = opened.liveViewUrl ? `\nWatch it live: ${opened.liveViewUrl}` : "\n(headless — no live view)";
        return ok(json, opened, `Opened ${opened.targetId}${watch}`);
      }

      case "list": {
        const targets = await commands.listTargets(ctx);
        const text = targets.length
          ? targets.map((t) => `${t.targetId}  ${t.liveViewUrl ?? "(headless)"}`).join("\n")
          : "no open targets";
        return ok(json, targets, text);
      }

      case "snapshot": {
        const targetId = requirePositional(positionals, "target-id");
        const snapshot = await commands.snapshotTarget(ctx, targetId);
        return ok(json, snapshot, `${snapshot.title}\n${snapshot.url}`);
      }

      case "click": {
        const targetId = requirePositional(positionals, "target-id");
        const x = stringFlag(flags, "x");
        const y = stringFlag(flags, "y");
        await commands.clickTarget(ctx, targetId, {
          selector: stringFlag(flags, "selector"),
          x: x ? Number(x) : undefined,
          y: y ? Number(y) : undefined,
        });
        return ok(json, { ok: true }, "clicked");
      }

      case "type": {
        const targetId = requirePositional(positionals, "target-id");
        const text = stringFlag(flags, "text");
        if (text === undefined) throw new Error("--text is required");
        await commands.typeIntoTarget(ctx, targetId, { selector: stringFlag(flags, "selector"), text });
        return ok(json, { ok: true }, "typed");
      }

      case "eval": {
        const targetId = requirePositional(positionals, "target-id");
        const script = await resolveScript(bb, flags, runCtx);
        const result = await commands.evaluateInTarget(ctx, targetId, script);
        const text = typeof result === "string" ? result : JSON.stringify(result);
        return ok(json, { result }, text);
      }

      case "close": {
        const targetId = requirePositional(positionals, "target-id");
        await commands.closeTarget(ctx, targetId);
        return ok(json, { ok: true }, "closed");
      }

      case "replay-start": {
        const targetId = requirePositional(positionals, "target-id");
        const framerate = stringFlag(flags, "framerate");
        const maxDuration = stringFlag(flags, "max-duration");
        const replay = await commands.startReplay(ctx, targetId, {
          framerate: framerate ? Number(framerate) : undefined,
          maxDurationSeconds: maxDuration ? Number(maxDuration) : undefined,
          recordAudio: flags.audio === true,
        });
        return ok(json, replay, `Started replay ${replay.replayId}`);
      }

      case "replay-stop": {
        const targetId = requirePositional(positionals, "target-id");
        const replayId = stringFlag(flags, "replay-id");
        if (!replayId) throw new Error("--replay-id is required");
        await commands.stopReplay(ctx, targetId, replayId);
        return ok(json, { ok: true }, "stopped");
      }

      case "replay-list": {
        const targetId = requirePositional(positionals, "target-id");
        const replays = await commands.listReplays(ctx, targetId);
        const text = replays.length
          ? replays.map((r) => `${r.replayId}  ${r.replayViewUrl ?? "(processing)"}`).join("\n")
          : "no replays";
        return ok(json, replays, text);
      }

      case "auth-create": {
        const domain = requirePositional(positionals, "domain");
        const profileName = stringFlag(flags, "profile");
        if (!profileName) throw new Error("--profile is required");
        const connection = await commands.createAuthConnection(ctx, {
          domain,
          profileName,
          loginUrl: stringFlag(flags, "login-url"),
          allowedDomains: listFlag(flags, "allowed-domains"),
        });
        return ok(json, connection, formatAuthConnection(connection));
      }

      case "auth-list": {
        const connections = await commands.listAuthConnections(ctx, {
          domain: stringFlag(flags, "domain"),
          profileName: stringFlag(flags, "profile"),
        });
        const text = connections.length ? connections.map(formatAuthConnection).join("\n\n") : "no auth connections";
        return ok(json, connections, text);
      }

      case "auth-get": {
        const connectionId = requirePositional(positionals, "connection-id");
        const connection = await commands.getAuthConnection(ctx, connectionId);
        return ok(json, connection, formatAuthConnection(connection));
      }

      case "auth-login": {
        const connectionId = requirePositional(positionals, "connection-id");
        const result = await commands.loginAuthConnection(ctx, connectionId);
        const text = result.hostedUrl
          ? `Started ${result.flowType} flow. Complete it at: ${result.hostedUrl}`
          : `Started ${result.flowType} flow (automatic re-auth in progress).`;
        return ok(json, result, text);
      }

      case "auth-wait": {
        const connectionId = requirePositional(positionals, "connection-id");
        const timeoutFlag = stringFlag(flags, "timeout");
        let timeoutSeconds: number | undefined;
        if (timeoutFlag !== undefined) {
          timeoutSeconds = Number(timeoutFlag);
          if (!Number.isFinite(timeoutSeconds)) throw new Error("--timeout must be a number");
        }
        const connection = await commands.waitForAuthConnection(ctx, connectionId, timeoutSeconds);
        return ok(json, connection, formatAuthConnection(connection));
      }

      case "auth-delete": {
        const connectionId = requirePositional(positionals, "connection-id");
        await commands.deleteAuthConnection(ctx, connectionId);
        return ok(json, { ok: true }, "deleted");
      }

      default:
        return fail(
          `unknown command "${command ?? ""}". Try: open, list, snapshot, click, type, eval, close, ` +
            "replay-start, replay-stop, replay-list, auth-create, auth-list, auth-get, auth-login, " +
            "auth-wait, auth-delete",
        );
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
