import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { rpcContract, TargetDto } from "./src/rpc.js";

function LiveViewPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [target, setTarget] = useState<TargetDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    rpc
      .call("latestForThread", { threadId })
      .then((res) => setTarget(res.target))
      .finally(() => setLoading(false));
  }, [rpc, threadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useRealtime(`kernel-browser:${threadId}`, refresh);

  async function close() {
    if (!target) return;
    await rpc.call("close", { targetId: target.targetId });
    setTarget(null);
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  if (!target) {
    return (
      <div style={{ padding: 16 }}>
        No Kernel browser opened in this thread yet. Ask the agent to open one, or run{" "}
        <code>bb kernel-browser open &lt;url&gt;</code>.
      </div>
    );
  }

  if (!target.liveViewUrl) {
    return (
      <div style={{ padding: 16 }}>
        <p>Target {target.targetId} is headless — no live view.</p>
        <button onClick={close}>Close</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(128, 128, 128, 0.25)",
          fontSize: 13,
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
        style={{ flex: 1, border: "none" }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "kernel-browser",
    title: "Kernel Browser",
    component: LiveViewPanel,
    run: async ({ threadId, openPanel }) => openPanel({ title: "Kernel Browser" }),
  });
});
