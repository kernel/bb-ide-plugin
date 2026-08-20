import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { AuthConnectionDto, rpcContract, ReplayDto, TargetDto } from "./src/rpc.js";

const REPLAY_POLL_INTERVAL_MS = 5000;
const AUTH_LOGIN_POLL_INTERVAL_MS = 3000;
const TERMINAL_AUTH_FLOW_STATUSES = new Set(["SUCCESS", "FAILED", "EXPIRED", "CANCELED"]);

function KernelLiveDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const targetId = attributes["target-id"];
  const rpc = useRpc<typeof rpcContract>();
  const [target, setTarget] = useState<TargetDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    rpc
      .call("getTarget", { targetId })
      .then((res) => setTarget(res.target))
      .finally(() => setLoading(false));
  }, [rpc, targetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useRealtime(`kernel-browser:${message.threadId}`, refresh);

  async function close() {
    if (!targetId) return;
    await rpc.call("close", { targetId });
    setTarget(null);
  }

  if (!targetId) {
    return <div style={{ padding: 8, fontSize: 13 }}>Missing target-id.</div>;
  }

  if (loading) return <div style={{ padding: 8, fontSize: 13 }}>Loading…</div>;

  if (!target) {
    return <div style={{ padding: 8, fontSize: 13 }}>Target {targetId} is closed or unknown.</div>;
  }

  if (!target.liveViewUrl) {
    return <div style={{ padding: 8, fontSize: 13 }}>Target {target.targetId} is headless — no live view.</div>;
  }

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
        <span>{target.targetId}</span>
        <div>
          <a href={target.liveViewUrl} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          <button onClick={close} style={{ marginLeft: 12 }}>
            Close
          </button>
        </div>
      </div>
      <iframe
        title="Kernel live view"
        src={target.liveViewUrl}
        style={{ width: "100%", height: 480, border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

function KernelReplayDirective({ attributes }: PluginMessageDirectiveProps) {
  const targetId = attributes["target-id"];
  const replayId = attributes["replay-id"];
  const rpc = useRpc<typeof rpcContract>();
  const [replay, setReplay] = useState<ReplayDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!targetId || !replayId) {
      setLoading(false);
      return;
    }
    rpc
      .call("getReplay", { targetId, replayId })
      .then((res) => setReplay(res.replay))
      .finally(() => setLoading(false));
  }, [rpc, targetId, replayId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (replay?.replayViewUrl) return;
    const interval = setInterval(refresh, REPLAY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh, replay?.replayViewUrl]);

  if (!targetId || !replayId) {
    return <div style={{ padding: 8, fontSize: 13 }}>Missing target-id or replay-id.</div>;
  }

  if (loading) return <div style={{ padding: 8, fontSize: 13 }}>Loading…</div>;

  if (!replay) {
    return <div style={{ padding: 8, fontSize: 13 }}>Replay {replayId} not found.</div>;
  }

  if (!replay.replayViewUrl) {
    return <div style={{ padding: 8, fontSize: 13 }}>Replay {replay.replayId} is still processing…</div>;
  }

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
        <span>{replay.replayId}</span>
        <a href={replay.replayViewUrl} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      </div>
      <iframe
        title="Kernel replay"
        src={replay.replayViewUrl}
        style={{ width: "100%", height: 480, border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

function KernelAuthLoginDirective({ attributes }: PluginMessageDirectiveProps) {
  const connectionId = attributes["connection-id"];
  const rpc = useRpc<typeof rpcContract>();
  const [connection, setConnection] = useState<AuthConnectionDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!connectionId) {
      setLoading(false);
      return;
    }
    rpc
      .call("getAuthConnection", { connectionId })
      .then((res) => setConnection(res.connection))
      .finally(() => setLoading(false));
  }, [rpc, connectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isTerminal = connection?.flowStatus ? TERMINAL_AUTH_FLOW_STATUSES.has(connection.flowStatus) : false;

  useEffect(() => {
    if (isTerminal) return;
    const interval = setInterval(refresh, AUTH_LOGIN_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh, isTerminal]);

  if (!connectionId) {
    return <div style={{ padding: 8, fontSize: 13 }}>Missing connection-id.</div>;
  }

  if (loading) return <div style={{ padding: 8, fontSize: 13 }}>Loading…</div>;

  if (!connection) {
    return <div style={{ padding: 8, fontSize: 13 }}>Auth connection {connectionId} not found.</div>;
  }

  if (connection.status === "AUTHENTICATED" && !connection.hostedUrl) {
    return (
      <div style={{ padding: 8, fontSize: 13 }}>
        Authenticated — {connection.domain} (profile {connection.profileName}).
      </div>
    );
  }

  if (connection.flowStatus && connection.flowStatus !== "IN_PROGRESS") {
    const label =
      connection.flowStatus === "SUCCESS"
        ? `Authenticated — ${connection.domain} (profile ${connection.profileName}).`
        : `Login ${connection.flowStatus.toLowerCase()} for ${connection.domain}.`;
    return <div style={{ padding: 8, fontSize: 13 }}>{label}</div>;
  }

  if (!connection.hostedUrl) {
    return (
      <div style={{ padding: 8, fontSize: 13 }}>
        Waiting on an automatic re-auth for {connection.domain} (profile {connection.profileName})…
      </div>
    );
  }

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
        <span>
          Log into {connection.domain} (profile {connection.profileName})
        </span>
        <a href={connection.hostedUrl} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      </div>
      <iframe
        title="Kernel hosted login"
        src={connection.hostedUrl}
        style={{ width: "100%", height: 480, border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
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
