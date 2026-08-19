// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act } from "@testing-library/react";
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

  it("tells the user a directive-linked target was closed, rather than claiming none was ever opened", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [panel] = app.threadPanelActions;
    const forTarget = vi.fn(async () => ({ target: null }));

    const slot = renderSlot(
      panel,
      { threadId: "thread-a", params: { targetId: "sess_gone" } },
      { rpc: { forTarget, latestForThread: async () => ({ target: null }), close: async () => ({ ok: true }) } },
    );

    await slot.findByText("Target sess_gone was closed or no longer exists.");
  });

  it("clears the previous target immediately when the panel is redirected to a different targetId", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [panel] = app.threadPanelActions;
    const Panel = panel.component;
    let resolveSecond: (value: { target: TargetDto | null }) => void = () => {};
    const secondLookup = new Promise<{ target: TargetDto | null }>((resolve) => {
      resolveSecond = resolve;
    });
    const forTarget = vi
      .fn()
      .mockResolvedValueOnce({ target: fakeTarget({ targetId: "sess_1" }) })
      .mockReturnValueOnce(secondLookup);

    const slot = renderSlot(
      panel,
      { threadId: "thread-a", params: { targetId: "sess_1" } },
      { rpc: { forTarget, latestForThread: async () => ({ target: null }), close: async () => ({ ok: true }) } },
    );
    await slot.findByText("sess_1");

    slot.lifecycle.rerender(<Panel threadId="thread-a" params={{ targetId: "sess_2" }} />);

    expect(slot.queryByText("sess_1")).toBeNull();
    expect(slot.getByText("Loading…")).toBeTruthy();

    resolveSecond({ target: fakeTarget({ targetId: "sess_2" }) });
    await slot.findByText("sess_2");
  });

  it("ignores a stale lookup that resolves after the panel has already switched targets", async () => {
    const app = await loadPluginApp(() => import("../app.js"));
    const [panel] = app.threadPanelActions;
    const Panel = panel.component;

    let resolveFirst: (value: { target: TargetDto | null }) => void = () => {};
    const firstLookup = new Promise<{ target: TargetDto | null }>((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond: (value: { target: TargetDto | null }) => void = () => {};
    const secondLookup = new Promise<{ target: TargetDto | null }>((resolve) => {
      resolveSecond = resolve;
    });
    const forTarget = vi.fn().mockReturnValueOnce(firstLookup).mockReturnValueOnce(secondLookup);

    const slot = renderSlot(
      panel,
      { threadId: "thread-a", params: { targetId: "sess_1" } },
      { rpc: { forTarget, latestForThread: async () => ({ target: null }), close: async () => ({ ok: true }) } },
    );

    // Switch targets before the first (sess_1) lookup has resolved.
    slot.lifecycle.rerender(<Panel threadId="thread-a" params={{ targetId: "sess_2" }} />);

    await act(async () => {
      resolveSecond({ target: fakeTarget({ targetId: "sess_2" }) });
      await secondLookup;
    });
    await slot.findByText("sess_2");

    // The stale sess_1 lookup resolves late — it must not clobber sess_2.
    await act(async () => {
      resolveFirst({ target: fakeTarget({ targetId: "sess_1" }) });
      await firstLookup;
    });

    expect(slot.queryByText("sess_1")).toBeNull();
    expect(slot.getByText("sess_2")).toBeTruthy();
  });
});
