import type { KernelBrowserClient, KernelTarget } from "./types.js";
import type { TargetStore } from "./store.js";
import {
  MAX_EVAL_SCRIPT_LENGTH,
  MAX_SELECTOR_LENGTH,
  MAX_TYPE_TEXT_LENGTH,
  MAX_URL_LENGTH,
  type TargetOrigin,
} from "./types.js";

export type TargetEvent = "opened" | "closed";

export interface CommandContext {
  client: KernelBrowserClient;
  store: TargetStore;
  notify(threadId: string | null, event: TargetEvent, targetId: string): void;
}

export interface OpenArgs {
  url?: string;
  stealth?: boolean;
  headless?: boolean;
  profileName?: string;
  timeoutSeconds?: number;
  threadId: string | null;
  createdBy: TargetOrigin;
}

export interface OpenSummary {
  targetId: string;
  liveViewUrl: string | null;
}

export interface TargetSummary {
  targetId: string;
  threadId: string | null;
  createdBy: TargetOrigin;
  liveViewUrl: string | null;
  createdAt: string;
  lastUsedAt: string;
}

function requireTarget(ctx: CommandContext, targetId: string) {
  const target = ctx.store.get(targetId);
  if (!target) {
    throw new Error(
      `unknown target "${targetId}" — it was never opened by this plugin, or has already been closed`,
    );
  }
  return target;
}

function toSummary(target: KernelTarget): TargetSummary {
  return {
    targetId: target.targetId,
    threadId: target.threadId,
    createdBy: target.createdBy,
    liveViewUrl: target.liveViewUrl,
    createdAt: new Date(target.createdAt).toISOString(),
    lastUsedAt: new Date(target.lastUsedAt).toISOString(),
  };
}

export async function openTarget(ctx: CommandContext, args: OpenArgs): Promise<OpenSummary> {
  if (args.url && args.url.length > MAX_URL_LENGTH) {
    throw new Error(`url exceeds ${MAX_URL_LENGTH} characters`);
  }
  const opened = await ctx.client.open(args);
  const now = Date.now();
  ctx.store.insert({
    targetId: opened.sessionId,
    threadId: args.threadId,
    createdBy: args.createdBy,
    liveViewUrl: opened.liveViewUrl,
    cdpWsUrl: opened.cdpWsUrl,
    createdAt: now,
    lastUsedAt: now,
  });
  ctx.notify(args.threadId, "opened", opened.sessionId);
  return { targetId: opened.sessionId, liveViewUrl: opened.liveViewUrl };
}

export async function listTargets(ctx: CommandContext): Promise<TargetSummary[]> {
  return ctx.store.listAll().map(toSummary);
}

export async function snapshotTarget(ctx: CommandContext, targetId: string) {
  requireTarget(ctx, targetId);
  const snapshot = await ctx.client.snapshot(targetId);
  ctx.store.touch(targetId);
  return snapshot;
}

export async function clickTarget(
  ctx: CommandContext,
  targetId: string,
  target: { selector?: string; x?: number; y?: number },
): Promise<void> {
  requireTarget(ctx, targetId);
  if (target.selector && target.selector.length > MAX_SELECTOR_LENGTH) {
    throw new Error(`selector exceeds ${MAX_SELECTOR_LENGTH} characters`);
  }
  await ctx.client.click(targetId, target);
  ctx.store.touch(targetId);
}

export async function typeIntoTarget(
  ctx: CommandContext,
  targetId: string,
  target: { selector?: string; text: string },
): Promise<void> {
  requireTarget(ctx, targetId);
  if (target.selector && target.selector.length > MAX_SELECTOR_LENGTH) {
    throw new Error(`selector exceeds ${MAX_SELECTOR_LENGTH} characters`);
  }
  if (target.text.length > MAX_TYPE_TEXT_LENGTH) {
    throw new Error(`text exceeds ${MAX_TYPE_TEXT_LENGTH} characters`);
  }
  await ctx.client.type(targetId, target);
  ctx.store.touch(targetId);
}

export async function evaluateInTarget(ctx: CommandContext, targetId: string, script: string): Promise<unknown> {
  requireTarget(ctx, targetId);
  if (script.length > MAX_EVAL_SCRIPT_LENGTH) {
    throw new Error(`script exceeds ${MAX_EVAL_SCRIPT_LENGTH} characters`);
  }
  const result = await ctx.client.evaluate(targetId, script);
  ctx.store.touch(targetId);
  return result;
}

export async function closeTarget(ctx: CommandContext, targetId: string): Promise<void> {
  const target = requireTarget(ctx, targetId);
  await ctx.client.close(targetId);
  ctx.store.remove(targetId);
  ctx.notify(target.threadId, "closed", targetId);
}

export interface CloseFailure {
  targetId: string;
  error: string;
}

export async function closeTargetsForThread(ctx: CommandContext, threadId: string): Promise<CloseFailure[]> {
  const failures: CloseFailure[] = [];
  for (const target of ctx.store.listByThread(threadId)) {
    try {
      await ctx.client.close(target.targetId);
      ctx.store.remove(target.targetId);
      ctx.notify(target.threadId, "closed", target.targetId);
    } catch (error) {
      failures.push({ targetId: target.targetId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}
