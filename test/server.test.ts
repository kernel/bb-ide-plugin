import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeClient, createKernelClientMock, fakeAuthClient, createKernelAuthClientMock } = vi.hoisted(() => {
  const fakeClient = {
    open: vi.fn(async () => ({
      sessionId: "sess_1",
      liveViewUrl: "https://live.example/sess_1",
      cdpWsUrl: "wss://cdp.example/sess_1",
    })),
    snapshot: vi.fn(async () => ({ url: "https://example.com", title: "Example" })),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    evaluate: vi.fn(async () => "eval-result"),
    close: vi.fn(async () => {}),
    startReplay: vi.fn(async () => ({
      replayId: "replay_1",
      replayViewUrl: null,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: null,
    })),
    stopReplay: vi.fn(async () => {}),
    listReplays: vi.fn(async () => [
      {
        replayId: "replay_1",
        replayViewUrl: "https://replay.example/replay_1",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:05:00Z",
      },
    ]),
  };
  const createKernelClientMock = vi.fn(() => fakeClient);

  const fakeAuthConnection = {
    connectionId: "conn_1",
    domain: "example.com",
    profileName: "my-profile",
    status: "NEEDS_AUTH" as const,
    flowType: null as null,
    flowStatus: null as null,
    hostedUrl: null as null,
    liveViewUrl: null as null,
  };
  const fakeAuthClient = {
    create: vi.fn(async () => fakeAuthConnection),
    get: vi.fn(async () => ({ ...fakeAuthConnection, status: "AUTHENTICATED" as const, flowStatus: "SUCCESS" as const, flowType: "LOGIN" as const })),
    list: vi.fn(async () => [fakeAuthConnection]),
    login: vi.fn(async () => ({
      connectionId: "conn_1",
      flowType: "LOGIN" as const,
      flowExpiresAt: "2026-01-01T00:10:00Z",
      hostedUrl: "https://managed-auth.onkernel.com/flow/conn_1",
      liveViewUrl: "https://live.example/conn_1",
    })),
    delete: vi.fn(async () => {}),
  };
  const createKernelAuthClientMock = vi.fn(() => fakeAuthClient);

  return { fakeClient, createKernelClientMock, fakeAuthClient, createKernelAuthClientMock };
});

vi.mock("../src/kernel-client.js", () => ({
  createKernelClient: createKernelClientMock,
}));

vi.mock("../src/kernel-auth-client.js", () => ({
  createKernelAuthClient: createKernelAuthClientMock,
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

  it("starts, stops, and lists replays via the CLI, scoped to a plugin-owned target", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"]);

    const start = await harness.behavior.runCli([
      "replay-start",
      "sess_1",
      "--framerate",
      "15",
      "--max-duration",
      "300",
      "--audio",
      "--json",
    ]);
    expect(start.exitCode).toBe(0);
    expect(start.stdout).toContain("replay_1");
    expect(fakeClient.startReplay).toHaveBeenCalledWith("sess_1", {
      framerate: 15,
      maxDurationSeconds: 300,
      recordAudio: true,
    });

    const list = await harness.behavior.runCli(["replay-list", "sess_1", "--json"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("https://replay.example/replay_1");

    const stop = await harness.behavior.runCli(["replay-stop", "sess_1", "--replay-id", "replay_1"]);
    expect(stop.exitCode).toBe(0);
    expect(fakeClient.stopReplay).toHaveBeenCalledWith("sess_1", "replay_1");

    const onUnknownTarget = await harness.behavior.runCli(["replay-start", "sess_unknown"]);
    expect(onUnknownTarget.exitCode).toBe(1);
    expect(onUnknownTarget.stderr).toMatch(/unknown target/);
  });

  it("registers replay agent tools that wrap the same commands", async () => {
    const { harness } = await setup();
    await harness.behavior.callAgentTool("kernel_browser_open", { url: "https://example.com" });

    const startResult = (await harness.behavior.callAgentTool("kernel_browser_replay_start", {
      targetId: "sess_1",
    })) as string;
    expect(startResult).toContain("replay_1");

    const listResult = (await harness.behavior.callAgentTool("kernel_browser_replay_list", {
      targetId: "sess_1",
    })) as string;
    expect(listResult).toContain("https://replay.example/replay_1");

    const stopResult = await harness.behavior.callAgentTool("kernel_browser_replay_stop", {
      targetId: "sess_1",
      replayId: "replay_1",
    });
    expect(stopResult).toBe("stopped");
    expect(fakeClient.stopReplay).toHaveBeenCalledWith("sess_1", "replay_1");
  });

  it("registers an agent tool that opens a target and allows a follow-up click", async () => {
    const { harness } = await setup();
    const openText = (await harness.behavior.callAgentTool("kernel_browser_open", {
      url: "https://example.com",
    })) as string;
    expect(openText).toContain("sess_1");

    const clickResult = await harness.behavior.callAgentTool("kernel_browser_click", {
      targetId: "sess_1",
      selector: "#submit",
    });
    expect(clickResult).toBe("clicked");
    expect(fakeClient.click).toHaveBeenCalledWith("sess_1", { selector: "#submit", x: undefined, y: undefined });
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

  it("looks up a target by id for the inline live view directive, and returns null once closed", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"], { threadId: "thread-a" });

    const found = (await harness.behavior.callRpc("getTarget", { targetId: "sess_1" })) as {
      target: { targetId: string; liveViewUrl: string | null } | null;
    };
    expect(found.target?.targetId).toBe("sess_1");
    expect(found.target?.liveViewUrl).toBe("https://live.example/sess_1");

    const missing = (await harness.behavior.callRpc("getTarget", { targetId: "sess_unknown" })) as {
      target: unknown;
    };
    expect(missing.target).toBeNull();

    await harness.behavior.callRpc("close", { targetId: "sess_1" });
    const afterClose = (await harness.behavior.callRpc("getTarget", { targetId: "sess_1" })) as {
      target: unknown;
    };
    expect(afterClose.target).toBeNull();
  });

  it("looks up a replay by id for the inline replay directive, before and after it finishes processing", async () => {
    const { harness } = await setup();
    await harness.behavior.runCli(["open", "https://example.com"]);
    await harness.behavior.runCli(["replay-start", "sess_1"]);

    const found = (await harness.behavior.callRpc("getReplay", {
      targetId: "sess_1",
      replayId: "replay_1",
    })) as { replay: { replayId: string; replayViewUrl: string | null } | null };
    expect(found.replay?.replayId).toBe("replay_1");
    expect(found.replay?.replayViewUrl).toBe("https://replay.example/replay_1");

    const missing = (await harness.behavior.callRpc("getReplay", {
      targetId: "sess_1",
      replayId: "replay_unknown",
    })) as { replay: unknown };
    expect(missing.replay).toBeNull();

    const onUnknownTarget = harness.behavior.callRpc("getReplay", {
      targetId: "sess_unknown",
      replayId: "replay_1",
    });
    await expect(onUnknownTarget).rejects.toThrow(/unknown target/);
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

  it("creates, lists, gets, logs into, waits for, and deletes an auth connection via the CLI", async () => {
    const { harness } = await setup();

    const created = await harness.behavior.runCli([
      "auth-create",
      "example.com",
      "--profile",
      "my-profile",
      "--allowed-domains",
      "sso.example.com, other.example.com",
    ]);
    expect(created.exitCode).toBe(0);
    expect(fakeAuthClient.create).toHaveBeenCalledWith({
      domain: "example.com",
      profileName: "my-profile",
      loginUrl: undefined,
      allowedDomains: ["sso.example.com", "other.example.com"],
    });

    const listed = await harness.behavior.runCli(["auth-list", "--domain", "example.com", "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("conn_1");
    expect(fakeAuthClient.list).toHaveBeenCalledWith({ domain: "example.com", profileName: undefined });

    const got = await harness.behavior.runCli(["auth-get", "conn_1", "--json"]);
    expect(got.exitCode).toBe(0);
    expect(got.stdout).toContain("AUTHENTICATED");

    const login = await harness.behavior.runCli(["auth-login", "conn_1"]);
    expect(login.exitCode).toBe(0);
    expect(login.stdout).toContain("https://managed-auth.onkernel.com/flow/conn_1");
    expect(fakeAuthClient.login).toHaveBeenCalledWith("conn_1");

    const waited = await harness.behavior.runCli(["auth-wait", "conn_1", "--timeout", "60", "--json"]);
    expect(waited.exitCode).toBe(0);
    expect(waited.stdout).toContain("SUCCESS");

    const deleted = await harness.behavior.runCli(["auth-delete", "conn_1"]);
    expect(deleted.exitCode).toBe(0);
    expect(fakeAuthClient.delete).toHaveBeenCalledWith("conn_1");
  });

  it("requires --profile on auth-create", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["auth-create", "example.com"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--profile is required/);
    expect(fakeAuthClient.create).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric --timeout on auth-wait instead of polling forever", async () => {
    const { harness } = await setup();
    const result = await harness.behavior.runCli(["auth-wait", "conn_1", "--timeout", "soon"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--timeout must be a number/);
    expect(fakeAuthClient.get).not.toHaveBeenCalled();
  });

  it("registers auth agent tools that wrap the same commands", async () => {
    const { harness } = await setup();

    const created = (await harness.behavior.callAgentTool("kernel_auth_create", {
      domain: "example.com",
      profileName: "my-profile",
    })) as string;
    expect(created).toContain("conn_1");

    const loginResult = (await harness.behavior.callAgentTool("kernel_auth_login", {
      connectionId: "conn_1",
    })) as string;
    expect(loginResult).toContain("https://managed-auth.onkernel.com/flow/conn_1");

    const waitResult = (await harness.behavior.callAgentTool("kernel_auth_wait", {
      connectionId: "conn_1",
    })) as string;
    expect(waitResult).toContain("AUTHENTICATED");

    const deleteResult = await harness.behavior.callAgentTool("kernel_auth_delete", { connectionId: "conn_1" });
    expect(deleteResult).toBe("deleted");
    expect(fakeAuthClient.delete).toHaveBeenCalledWith("conn_1");
  });

  it("looks up an auth connection by id for the inline hosted-login directive, returning null for unknown ids", async () => {
    const { harness } = await setup();

    const found = (await harness.behavior.callRpc("getAuthConnection", { connectionId: "conn_1" })) as {
      connection: { connectionId: string; status: string } | null;
    };
    expect(found.connection?.connectionId).toBe("conn_1");
    expect(found.connection?.status).toBe("AUTHENTICATED");

    fakeAuthClient.get.mockRejectedValueOnce(new Error("not found"));
    const missing = (await harness.behavior.callRpc("getAuthConnection", { connectionId: "conn_unknown" })) as {
      connection: unknown;
    };
    expect(missing.connection).toBeNull();
  });
});
