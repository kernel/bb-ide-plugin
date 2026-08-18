// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it, vi } from "vitest";
import type { TargetDto } from "../src/rpc.js";

function fakeTarget(overrides: Partial<TargetDto> = {}): TargetDto {
  return {
    targetId: "sess_1",
    threadId: "thread-a",
    createdBy: "agent",
    liveViewUrl: "https://live.example/sess_1",
    createdAt: new Date(0).toISOString(),
    lastUsedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("kernel-browser app", () => {
  it("registers the thread panel action and the live-view message directive", async () => {
    const app = await loadPluginApp(() => import("../app.js"));

    expect(app.threadPanelActions.map((a) => a.id)).toContain("kernel-browser");
    expect(app.messageDirectives.map((d) => d.id)).toContain("kernel-live-view");
  });

  it("opens the Kernel Browser panel for the directive's target when clicked", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [directive] = app.messageDirectives;

    const slot = renderSlot(
      directive,
      {
        attributes: { targetId: "sess_1" },
        source: '::kernel-live-view{targetId="sess_1"}',
        message: { id: "msg_1", threadId: "thread-a", turnId: null, projectId: null },
        openWorkspaceFile: null,
      },
      { openThreadPanel: () => true },
    );

    slot.getByText("▶ Watch live").click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "kernel-browser", title: "Kernel Browser", params: { targetId: "sess_1" } },
    });
  });

  it("renders nothing when the directive is missing its targetId attribute", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [directive] = app.messageDirectives;

    const slot = renderSlot(
      directive,
      {
        attributes: {},
        source: "::kernel-live-view{}",
        message: { id: "msg_1", threadId: "thread-a", turnId: null, projectId: null },
        openWorkspaceFile: null,
      },
      {},
    );

    expect(slot.container.textContent).toBe("");
  });

  it("looks up the panel's target by id when opened with a targetId param", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [panel] = app.threadPanelActions;
    const forTarget = vi.fn(async () => ({ target: fakeTarget() }));

    const slot = renderSlot(
      panel,
      { threadId: "thread-a", params: { targetId: "sess_1" } },
      { rpc: { forTarget, latestForThread: async () => ({ target: null }), close: async () => ({ ok: true }) } },
    );

    await vi.waitFor(() => expect(forTarget).toHaveBeenCalledWith({ targetId: "sess_1" }));
    await slot.findByText("sess_1");
  });

  it("falls back to the thread's latest target when opened without params", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [panel] = app.threadPanelActions;
    const latestForThread = vi.fn(async () => ({ target: fakeTarget({ targetId: "sess_2" }) }));

    const slot = renderSlot(
      panel,
      { threadId: "thread-a", params: null },
      { rpc: { latestForThread, forTarget: async () => ({ target: null }), close: async () => ({ ok: true }) } },
    );

    await vi.waitFor(() => expect(latestForThread).toHaveBeenCalledWith({ threadId: "thread-a" }));
    await slot.findByText("sess_2");
  });
});
