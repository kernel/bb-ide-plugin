import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AuthConnectionDto, rpcContract, ReplayDto, TargetDto } from "./src/rpc.js";

const REPLAY_POLL_INTERVAL_MS = 5000;
const AUTH_LOGIN_POLL_INTERVAL_MS = 3000;
const TERMINAL_AUTH_FLOW_STATUSES = new Set(["SUCCESS", "FAILED", "EXPIRED", "CANCELED"]);

function Note({ children }: { children: ReactNode }) {
  return <div style={{ padding: 8, fontSize: 13 }}>{children}</div>;
}

function EmbedCard({
  title,
  actions,
  iframeTitle,
  iframeSrc,
}: {
  title: ReactNode;
  actions?: ReactNode;
  iframeTitle: string;
  iframeSrc: string;
}) {
  return (
    <div style={{ border: "1px solid rgba(128, 128, 128, 0.25)", borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(128, 128, 128, 0.25)",
          fontSize: 12,
        }}
      >
        <span>{title}</span>
        {actions}
      </div>
      <iframe
        title={iframeTitle}
        src={iframeSrc}
        style={{ width: "100%", height: 480, border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

interface UsePolledLookupOptions<T> {
  pollIntervalMs?: number;
  isDone?: (value: T | null) => boolean;
}

/**
 * Fetches once on mount via a memoized `fetch`, and — while `isDone` (default: always) says
 * no — re-fetches every `pollIntervalMs`. `fetch` returning undefined skips the fetch (e.g. a
 * required id is missing) without disabling the poll, matching each directive's prior behavior.
 */
function usePolledLookup<T>(fetch: () => Promise<T> | undefined, options: UsePolledLookupOptions<T> = {}) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const result = fetch();
    if (!result) {
      setLoading(false);
      return;
    }
    result.then(setValue).finally(() => setLoading(false));
  }, [fetch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const done = options.isDone ? options.isDone(value) : true;
  const pollIntervalMs = options.pollIntervalMs;

  useEffect(() => {
    if (!pollIntervalMs || done) return;
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, pollIntervalMs, done]);

  return { value, setValue, loading, refresh };
}

function KernelLiveDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const targetId = attributes["target-id"];
  const rpc = useRpc<typeof rpcContract>();

  const fetchTarget = useCallback(() => {
    if (!targetId) return undefined;
    return rpc.call("getTarget", { targetId }).then((res) => res.target);
  }, [rpc, targetId]);

  const { value: target, setValue: setTarget, loading, refresh } = usePolledLookup<TargetDto | null>(fetchTarget);

  useRealtime(`kernel-browser:${message.threadId}`, refresh);

  async function close() {
    if (!targetId) return;
    await rpc.call("close", { targetId });
    setTarget(null);
  }

  if (!targetId) return <Note>Missing target-id.</Note>;
  if (loading) return <Note>Loading…</Note>;
  if (!target) return <Note>Target {targetId} is closed or unknown.</Note>;
  if (!target.liveViewUrl) return <Note>Target {target.targetId} is headless — no live view.</Note>;

  return (
    <EmbedCard
      title={target.targetId}
      actions={
        <div>
          <a href={target.liveViewUrl} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          <button onClick={close} style={{ marginLeft: 12 }}>
            Close
          </button>
        </div>
      }
      iframeTitle="Kernel live view"
      iframeSrc={target.liveViewUrl}
    />
  );
}

function KernelReplayDirective({ attributes }: PluginMessageDirectiveProps) {
  const targetId = attributes["target-id"];
  const replayId = attributes["replay-id"];
  const rpc = useRpc<typeof rpcContract>();

  const fetchReplay = useCallback(() => {
    if (!targetId || !replayId) return undefined;
    return rpc.call("getReplay", { targetId, replayId }).then((res) => res.replay);
  }, [rpc, targetId, replayId]);

  const { value: replay, loading } = usePolledLookup<ReplayDto | null>(fetchReplay, {
    pollIntervalMs: REPLAY_POLL_INTERVAL_MS,
    isDone: (r) => Boolean(r?.replayViewUrl),
  });

  if (!targetId || !replayId) return <Note>Missing target-id or replay-id.</Note>;
  if (loading) return <Note>Loading…</Note>;
  if (!replay) return <Note>Replay {replayId} not found.</Note>;
  if (!replay.replayViewUrl) return <Note>Replay {replay.replayId} is still processing…</Note>;

  return (
    <EmbedCard
      title={replay.replayId}
      actions={
        <a href={replay.replayViewUrl} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      }
      iframeTitle="Kernel replay"
      iframeSrc={replay.replayViewUrl}
    />
  );
}

function KernelAuthLoginDirective({ attributes }: PluginMessageDirectiveProps) {
  const connectionId = attributes["connection-id"];
  const rpc = useRpc<typeof rpcContract>();

  const fetchConnection = useCallback(() => {
    if (!connectionId) return undefined;
    return rpc.call("getAuthConnection", { connectionId }).then((res) => res.connection);
  }, [rpc, connectionId]);

  const { value: connection, loading } = usePolledLookup<AuthConnectionDto | null>(fetchConnection, {
    pollIntervalMs: AUTH_LOGIN_POLL_INTERVAL_MS,
    isDone: (c) => Boolean(c?.flowStatus && TERMINAL_AUTH_FLOW_STATUSES.has(c.flowStatus)),
  });

  if (!connectionId) return <Note>Missing connection-id.</Note>;
  if (loading) return <Note>Loading…</Note>;
  if (!connection) return <Note>Auth connection {connectionId} not found.</Note>;

  if (connection.status === "AUTHENTICATED" && !connection.hostedUrl) {
    return (
      <Note>
        Authenticated — {connection.domain} (profile {connection.profileName}).
      </Note>
    );
  }

  if (connection.flowStatus && connection.flowStatus !== "IN_PROGRESS") {
    const label =
      connection.flowStatus === "SUCCESS"
        ? `Authenticated — ${connection.domain} (profile ${connection.profileName}).`
        : `Login ${connection.flowStatus.toLowerCase()} for ${connection.domain}.`;
    return <Note>{label}</Note>;
  }

  if (!connection.hostedUrl) {
    return (
      <Note>
        Waiting on an automatic re-auth for {connection.domain} (profile {connection.profileName})…
      </Note>
    );
  }

  return (
    <EmbedCard
      title={
        <>
          Log into {connection.domain} (profile {connection.profileName})
        </>
      }
      actions={
        <a href={connection.hostedUrl} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      }
      iframeTitle="Kernel hosted login"
      iframeSrc={connection.hostedUrl}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "kernel-live",
    component: KernelLiveDirective,
  });
  app.slots.messageDirective({
    id: "kernel-replay",
    component: KernelReplayDirective,
  });
  app.slots.messageDirective({
    id: "kernel-auth-login",
    component: KernelAuthLoginDirective,
  });
});
