import type {
  AuthConnectionSummary,
  KernelAuthClient,
  KernelBrowserClient,
  KernelTarget,
  ListAuthConnectionsFilter,
  LoginFlowResult,
  ReplayInfo,
  StartReplayOptions,
} from "./types.js";
import type { TargetStore } from "./store.js";
import {
  DEFAULT_AUTH_WAIT_SECONDS,
  isTerminalAuthFlowStatus,
  MAX_ALLOWED_DOMAINS,
  MAX_AUTH_WAIT_SECONDS,
  MAX_DOMAIN_LENGTH,
  MAX_EVAL_SCRIPT_LENGTH,
  MAX_LOGIN_URL_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_SELECTOR_LENGTH,
  MAX_TYPE_TEXT_LENGTH,
  MAX_URL_LENGTH,
  AUTH_POLL_INTERVAL_MS,
  type TargetOrigin,
} from "./types.js";

export type TargetEvent = "opened" | "closed";

export interface CommandContext {
  client: KernelBrowserClient;
  authClient: KernelAuthClient;
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

export async function getTarget(ctx: CommandContext, targetId: string): Promise<TargetSummary | null> {
  const target = ctx.store.get(targetId);
  return target ? toSummary(target) : null;
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

export async function startReplay(
  ctx: CommandContext,
  targetId: string,
  opts: StartReplayOptions = {},
): Promise<ReplayInfo> {
  requireTarget(ctx, targetId);
  const replay = await ctx.client.startReplay(targetId, opts);
  ctx.store.touch(targetId);
  return replay;
}

export async function stopReplay(ctx: CommandContext, targetId: string, replayId: string): Promise<void> {
  requireTarget(ctx, targetId);
  await ctx.client.stopReplay(targetId, replayId);
  ctx.store.touch(targetId);
}

export async function listReplays(ctx: CommandContext, targetId: string): Promise<ReplayInfo[]> {
  requireTarget(ctx, targetId);
  return ctx.client.listReplays(targetId);
}

export async function getReplay(ctx: CommandContext, targetId: string, replayId: string): Promise<ReplayInfo | null> {
  requireTarget(ctx, targetId);
  const replays = await ctx.client.listReplays(targetId);
  return replays.find((r) => r.replayId === replayId) ?? null;
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

export interface CreateAuthConnectionArgs {
  domain: string;
  profileName: string;
  loginUrl?: string;
  allowedDomains?: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createAuthConnection(
  ctx: CommandContext,
  args: CreateAuthConnectionArgs,
): Promise<AuthConnectionSummary> {
  if (args.domain.length > MAX_DOMAIN_LENGTH) {
    throw new Error(`domain exceeds ${MAX_DOMAIN_LENGTH} characters`);
  }
  if (args.profileName.length > MAX_PROFILE_NAME_LENGTH) {
    throw new Error(`profile name exceeds ${MAX_PROFILE_NAME_LENGTH} characters`);
  }
  if (args.loginUrl && args.loginUrl.length > MAX_LOGIN_URL_LENGTH) {
    throw new Error(`login url exceeds ${MAX_LOGIN_URL_LENGTH} characters`);
  }
  if (args.allowedDomains && args.allowedDomains.length > MAX_ALLOWED_DOMAINS) {
    throw new Error(`allowed domains exceeds ${MAX_ALLOWED_DOMAINS} entries`);
  }
  return ctx.authClient.create(args);
}

export async function listAuthConnections(
  ctx: CommandContext,
  filter: ListAuthConnectionsFilter,
): Promise<AuthConnectionSummary[]> {
  return ctx.authClient.list(filter);
}

export async function getAuthConnection(ctx: CommandContext, connectionId: string): Promise<AuthConnectionSummary> {
  return ctx.authClient.get(connectionId);
}

export async function loginAuthConnection(ctx: CommandContext, connectionId: string): Promise<LoginFlowResult> {
  return ctx.authClient.login(connectionId);
}

export async function deleteAuthConnection(ctx: CommandContext, connectionId: string): Promise<void> {
  await ctx.authClient.delete(connectionId);
}

export async function waitForAuthConnection(
  ctx: CommandContext,
  connectionId: string,
  timeoutSeconds: number = DEFAULT_AUTH_WAIT_SECONDS,
): Promise<AuthConnectionSummary> {
  const boundedTimeoutSeconds = Math.min(Math.max(timeoutSeconds, 0), MAX_AUTH_WAIT_SECONDS);
  const deadline = Date.now() + boundedTimeoutSeconds * 1000;
  for (;;) {
    const connection = await ctx.authClient.get(connectionId);
    if (isTerminalAuthFlowStatus(connection.flowStatus)) {
      return connection;
    }
    if (Date.now() >= deadline) {
      return connection;
    }
    await sleep(AUTH_POLL_INTERVAL_MS);
  }
}
