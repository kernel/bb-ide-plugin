import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { rpcContract, TargetDto } from "./src/rpc.js";

function targetIdFromParams(params: PluginThreadPanelProps["params"]): string | null {
  if (params && typeof params === "object" && !Array.isArray(params) && typeof params.targetId === "string") {
    return params.targetId;
  }
  return null;
}

function LiveViewPanel({ threadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const targetId = targetIdFromParams(params);
  const [target, setTarget] = useState<TargetDto | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current;
    const call = targetId ? rpc.call("forTarget", { targetId }) : rpc.call("latestForThread", { threadId });
    call
      .then((res) => {
        if (requestIdRef.current === requestId) setTarget(res.target);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [rpc, threadId, targetId]);

  useEffect(() => {
    // Clear out the previous target immediately so a panel switched to a
    // new targetId (via the live-view chip) never shows the old iframe
    // while the new lookup is still in flight.
    setLoading(true);
    setTarget(null);
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
        {targetId ? (
          <p>Target {targetId} was closed or no longer exists.</p>
        ) : (
          <p>
            No Kernel browser opened in this thread yet. Ask the agent to open one, or run{" "}
            <code>bb kernel-browser open &lt;url&gt;</code>.
          </p>
        )}
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

function LiveViewChip({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const targetId = attributes.targetId;

  if (!targetId) return null;

  return (
    <button
      onClick={() =>
        navigate.openThreadPanel({ actionId: "kernel-browser", title: "Kernel Browser", params: { targetId } })
      }
    >
      ▶ Watch live
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "kernel-browser",
    title: "Kernel Browser",
    component: LiveViewPanel,
    run: async ({ threadId, openPanel }) => openPanel({ title: "Kernel Browser" }),
  });

  app.slots.messageDirective({
    id: "kernel-live-view",
    component: LiveViewChip,
  });
});
