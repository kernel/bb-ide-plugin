export type TargetOrigin = "cli" | "agent";

export interface KernelTarget {
  targetId: string;
  threadId: string | null;
  createdBy: TargetOrigin;
  liveViewUrl: string | null;
  cdpWsUrl: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface OpenOptions {
  url?: string;
  stealth?: boolean;
  headless?: boolean;
  profileName?: string;
  timeoutSeconds?: number;
}

export interface OpenResult {
  sessionId: string;
  liveViewUrl: string | null;
  cdpWsUrl: string;
}

export interface SnapshotResult {
  url: string;
  title: string;
}

export interface ClickTarget {
  selector?: string;
  x?: number;
  y?: number;
}

export interface TypeTarget {
  selector?: string;
  text: string;
}

export interface StartReplayOptions {
  framerate?: number;
  maxDurationSeconds?: number;
  recordAudio?: boolean;
}

export interface ReplayInfo {
  replayId: string;
  replayViewUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface KernelBrowserClient {
  open(opts: OpenOptions): Promise<OpenResult>;
  snapshot(sessionId: string): Promise<SnapshotResult>;
  click(sessionId: string, target: ClickTarget): Promise<void>;
  type(sessionId: string, target: TypeTarget): Promise<void>;
  evaluate(sessionId: string, script: string): Promise<unknown>;
  close(sessionId: string): Promise<void>;
  startReplay(sessionId: string, opts: StartReplayOptions): Promise<ReplayInfo>;
  stopReplay(sessionId: string, replayId: string): Promise<void>;
  listReplays(sessionId: string): Promise<ReplayInfo[]>;
}

export const MAX_EVAL_SCRIPT_LENGTH = 8192;
export const MAX_TYPE_TEXT_LENGTH = 4096;
export const MAX_URL_LENGTH = 4096;
export const MAX_SELECTOR_LENGTH = 512;

export type AuthConnectionStatus = "AUTHENTICATED" | "NEEDS_AUTH";
export type AuthFlowType = "LOGIN" | "REAUTH";
export type AuthFlowStatus = "IN_PROGRESS" | "SUCCESS" | "FAILED" | "EXPIRED" | "CANCELED";

export interface CreateAuthConnectionOptions {
  domain: string;
  profileName: string;
  loginUrl?: string;
  allowedDomains?: string[];
}

export interface ListAuthConnectionsFilter {
  domain?: string;
  profileName?: string;
}

export interface AuthConnectionSummary {
  connectionId: string;
  domain: string;
  profileName: string;
  status: AuthConnectionStatus;
  flowType: AuthFlowType | null;
  flowStatus: AuthFlowStatus | null;
  hostedUrl: string | null;
  liveViewUrl: string | null;
}

export interface LoginFlowResult {
  connectionId: string;
  flowType: AuthFlowType;
  flowExpiresAt: string;
  hostedUrl: string | null;
  liveViewUrl: string | null;
}

export interface KernelAuthClient {
  create(opts: CreateAuthConnectionOptions): Promise<AuthConnectionSummary>;
  get(connectionId: string): Promise<AuthConnectionSummary>;
  list(filter: ListAuthConnectionsFilter): Promise<AuthConnectionSummary[]>;
  login(connectionId: string): Promise<LoginFlowResult>;
  delete(connectionId: string): Promise<void>;
}

export const MAX_DOMAIN_LENGTH = 255;
export const MAX_PROFILE_NAME_LENGTH = 128;
export const MAX_LOGIN_URL_LENGTH = 2048;
export const MAX_ALLOWED_DOMAINS = 20;
export const DEFAULT_AUTH_WAIT_SECONDS = 120;
export const MAX_AUTH_WAIT_SECONDS = 300;
export const AUTH_POLL_INTERVAL_MS = 2000;

const TERMINAL_AUTH_FLOW_STATUSES: ReadonlySet<AuthFlowStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "EXPIRED",
  "CANCELED",
]);

export function isTerminalAuthFlowStatus(status: AuthFlowStatus | null): boolean {
  return status !== null && TERMINAL_AUTH_FLOW_STATUSES.has(status);
}
