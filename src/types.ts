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

export interface RemoteBrowserSummary {
  sessionId: string;
  liveViewUrl: string | null;
  createdAt: string;
  headless: boolean;
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

export interface KernelBrowserClient {
  open(opts: OpenOptions): Promise<OpenResult>;
  list(): Promise<RemoteBrowserSummary[]>;
  snapshot(sessionId: string): Promise<SnapshotResult>;
  click(sessionId: string, target: ClickTarget): Promise<void>;
  type(sessionId: string, target: TypeTarget): Promise<void>;
  evaluate(sessionId: string, script: string): Promise<unknown>;
  close(sessionId: string): Promise<void>;
}

export const MAX_EVAL_SCRIPT_LENGTH = 8192;
export const MAX_TYPE_TEXT_LENGTH = 4096;
export const MAX_URL_LENGTH = 4096;
export const MAX_SELECTOR_LENGTH = 512;
