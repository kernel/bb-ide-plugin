import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenResult } from "../src/types.js";

const { fakeClient, createKernelClientMock } = vi.hoisted(() => {
  const fakeClient = {
    open: vi.fn(
      async (): Promise<OpenResult> => ({
        sessionId: "sess_1",
        liveViewUrl: "https://live.example/sess_1",
        cdpWsUrl: "wss://cdp.example/sess_1",
      }),
    ),
    snapshot: vi.fn(async () => ({ url: "https://example.com", title: "Example" })),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    evaluate: vi.fn(async () => "eval-result"),
    close: vi.fn(async () => {}),
  };
  const createKernelClientMock = vi.fn(() => fakeClient);
  return { fakeClient, createKernelClientMock };
});

vi.mock("../src/kernel-client.js", () => ({
  createKernelClient: createKernelClientMock,
}));

const { default: plugin } = await import("../src/server.js");

async function setup(settings: Record<string, PluginSettingValue> = { apiKey: "test-key" }) {
  const { bb, harness } = createFakePluginHost({ pluginId: "kernel-browser", settings });
  await plugin(bb);
  return { bb, harness };
}

describe("kernel-browser plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClient.open.mockResolvedValue({
      sessionId: "sess_1",
      liveViewUrl: "https://live.example/sess_1",
      cdpWsUrl: "wss://cdp.example/sess_1",
    });
  });

  it("opens a browser via the CLI and prints the live view url", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["open", "https://example.com", "--stealth"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sess_1");
    expect(result.stdout).toContain("https://live.example/sess_1");
    expect(fakeClient.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com", stealth: true }),
    );
  });

  it("does not swallow a positional argument that follows a boolean flag", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["open", "--stealth", "https://example.com"]);

    expect(result.exitCode).toBe(0);
    expect(fakeClient.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com", stealth: true }),
    );
  });

  it("refuses to act on a target this plugin never opened", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["click", "sess_unknown", "--selector", "button"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/unknown target/);
    expect(fakeClient.click).not.toHaveBeenCalled();
  });

  it("tracks a target opened by the CLI so a later command can act on it", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"]);

    const snapshot = await harness.behavior.runCli(["snapshot", "sess_1", "--json"]);
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.stdout).toContain("Example");

    const closed = await harness.behavior.runCli(["close", "sess_1"]);
    expect(closed.exitCode).toBe(0);
    expect(fakeClient.close).toHaveBeenCalledWith("sess_1");

    const afterClose = await harness.behavior.runCli(["snapshot", "sess_1"]);
    expect(afterClose.exitCode).toBe(1);
  });

  it("caps eval script length instead of forwarding an unbounded script", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"]);

    const hugeScript = "a".repeat(20_000);
    const result = await harness.behavior.runCli(["eval", "sess_1", "--script", hugeScript]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/exceeds/);
    expect(fakeClient.evaluate).not.toHaveBeenCalled();
  });

  it("registers an agent tool that opens a target and allows a follow-up click", async () => {
    const { harness } = await setup();
    const openText = (await harness.behavior.callAgentTool("kernel_browser_open", {
      url: "https://example.com",
    })) as string;
    expect(openText).toContain("sess_1");
    expect(openText).toContain('::kernel-live-view{targetId="sess_1"}');

    const clickResult = await harness.behavior.callAgentTool("kernel_browser_click", {
      targetId: "sess_1",
      selector: "#submit",
    });
    expect(clickResult).toBe("clicked");
    expect(fakeClient.click).toHaveBeenCalledWith("sess_1", { selector: "#submit", x: undefined, y: undefined });
  });

  it("skips the live-view directive for a headless open", async () => {
    const { harness } = await setup();
    fakeClient.open.mockResolvedValueOnce({
      sessionId: "sess_headless",
      liveViewUrl: null,
      cdpWsUrl: "wss://cdp.example/sess_headless",
    });

    const openText = (await harness.behavior.callAgentTool("kernel_browser_open", {
      url: "https://example.com",
    })) as string;

    expect(openText).toContain("sess_headless");
    expect(openText).not.toContain("kernel-live-view");
  });

  it("reports needs-configuration when no api key is set", async () => {
    const { harness } = await setup({});
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
    expect(harness.needsConfigurationMessages[0]).toMatch(/apiKey/);

    const result = await harness.behavior.runCli(["open", "https://example.com"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not configured/);
  });

  it("swaps the live Kernel client when apiKey changes, without a reload", async () => {
    const { harness } = await setup();
    expect(createKernelClientMock).toHaveBeenCalledWith("test-key");

    await harness.behavior.setSettings({ apiKey: "rotated-key" });
    expect(createKernelClientMock).toHaveBeenCalledWith("rotated-key");

    const result = await harness.behavior.runCli(["open", "https://example.com"]);
    expect(result.exitCode).toBe(0);
  });

  it("publishes a realtime signal on open and on close, for CLI-driven targets too", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"], { threadId: "thread-a" });

    expect(harness.realtimeSignals).toContainEqual(
      expect.objectContaining({
        channel: "kernel-browser:thread-a",
        payload: expect.objectContaining({ event: "opened", targetId: "sess_1" }),
      }),
    );

    await harness.behavior.runCli(["close", "sess_1"], { threadId: "thread-a" });
    expect(harness.realtimeSignals).toContainEqual(
      expect.objectContaining({
        channel: "kernel-browser:thread-a",
        payload: expect.objectContaining({ event: "closed", targetId: "sess_1" }),
      }),
    );
  });

  it("scopes latestForThread to the requesting thread, not just the most recent target overall", async () => {
    const { harness } = await setup();
    fakeClient.open.mockResolvedValueOnce({
      sessionId: "sess_a",
      liveViewUrl: "https://live.example/sess_a",
      cdpWsUrl: "wss://cdp.example/sess_a",
    });
    await harness.behavior.runCli(["open", "https://a.example.com"], { threadId: "thread-a" });

    fakeClient.open.mockResolvedValueOnce({
      sessionId: "sess_b",
      liveViewUrl: "https://live.example/sess_b",
      cdpWsUrl: "wss://cdp.example/sess_b",
    });
    await harness.behavior.runCli(["open", "https://b.example.com"], { threadId: "thread-b" });

    const forA = (await harness.behavior.callRpc("latestForThread", { threadId: "thread-a" })) as {
      target: { targetId: string } | null;
    };
    expect(forA.target?.targetId).toBe("sess_a");

    const forB = (await harness.behavior.callRpc("latestForThread", { threadId: "thread-b" })) as {
      target: { targetId: string } | null;
    };
    expect(forB.target?.targetId).toBe("sess_b");
  });

  it("looks up a target by id via forTarget, for the live-view chip's panel navigation", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"], { threadId: "thread-a" });

    const found = (await harness.behavior.callRpc("forTarget", { targetId: "sess_1" })) as {
      target: { targetId: string; threadId: string } | null;
    };
    expect(found.target?.targetId).toBe("sess_1");
    expect(found.target?.threadId).toBe("thread-a");

    const missing = (await harness.behavior.callRpc("forTarget", { targetId: "sess_unknown" })) as {
      target: unknown | null;
    };
    expect(missing.target).toBeNull();
  });

  it("closes every target for a thread when it is archived", async () => {
    const { harness } = await setup();
    // callAgentTool defaults its context threadId to "thread-test".
    await harness.behavior.callAgentTool("kernel_browser_open", { url: "https://example.com" });

    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thread-test" }),
    });

    expect(fakeClient.close).toHaveBeenCalledWith("sess_1");
  });

  it("logs and keeps the target when the remote close fails during thread cleanup", async () => {
    const { harness } = await setup();
    await harness.behavior.callAgentTool("kernel_browser_open", { url: "https://example.com" });
    fakeClient.close.mockRejectedValueOnce(new Error("kernel API unreachable"));

    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thread-test" }),
    });

    expect(harness.logEntries).toContainEqual(
      expect.objectContaining({ level: "warn", message: expect.stringContaining("kernel API unreachable") }),
    );

    const snapshot = await harness.behavior.runCli(["snapshot", "sess_1"]);
    expect(snapshot.exitCode).toBe(0);
  });
});
