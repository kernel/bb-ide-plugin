import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract, TargetDto } from "./src/rpc.js";

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

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "kernel-live",
    component: KernelLiveDirective,
  });
});
