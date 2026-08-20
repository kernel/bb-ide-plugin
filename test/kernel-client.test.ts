import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeExecuteResponse {
  success: boolean;
  error?: string;
  result?: unknown;
}

const fakeSdk = {
  browsers: {
    create: vi.fn(async () => ({
      session_id: "sess_1",
      browser_live_view_url: "https://live.example/sess_1",
      cdp_ws_url: "wss://cdp.example/sess_1",
    })),
    deleteByID: vi.fn(async () => {}),
    playwright: {
      execute: vi.fn(
        async (): Promise<FakeExecuteResponse> => ({
          success: true,
          result: { url: "https://example.com", title: "Example" },
        }),
      ),
    },
    computer: {
      clickMouse: vi.fn(async () => {}),
      typeText: vi.fn(async () => {}),
    },
    replays: {
      start: vi.fn(async () => ({
        replay_id: "replay_1",
        replay_view_url: undefined,
        started_at: "2026-01-01T00:00:00Z",
        finished_at: null,
      })),
      stop: vi.fn(async () => {}),
      list: vi.fn(async () => [
        {
          replay_id: "replay_1",
          replay_view_url: "https://replay.example/replay_1",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:05:00Z",
        },
      ]),
    },
  },
};

class FakeKernel {
  browsers = fakeSdk.browsers;
}

vi.mock("@onkernel/sdk", () => ({ default: FakeKernel }));

const { createKernelClient } = await import("../src/kernel-client.js");

describe("createKernelClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSdk.browsers.playwright.execute.mockResolvedValue({
      success: true,
      result: { url: "https://example.com", title: "Example" },
    });
  });

  it("maps a profile name onto the SDK's nested profile shape", async () => {
    const client = createKernelClient("test-key");
    await client.open({ profileName: "my-profile" });

    expect(fakeSdk.browsers.create).toHaveBeenCalledWith(
      expect.objectContaining({ profile: { name: "my-profile" } }),
    );
  });

  it("surfaces Kernel's own error when a Playwright execution fails", async () => {
    fakeSdk.browsers.playwright.execute.mockResolvedValue({
      success: false,
      error: "selector not found: #missing",
    });
    const client = createKernelClient("test-key");

    await expect(client.snapshot("sess_1")).rejects.toThrow("selector not found: #missing");
    await expect(client.evaluate("sess_1", "return 1;")).rejects.toThrow("selector not found: #missing");
  });

  it("falls back to a generic message when a failed execution has no error text", async () => {
    fakeSdk.browsers.playwright.execute.mockResolvedValue({ success: false });
    const client = createKernelClient("test-key");

    await expect(client.evaluate("sess_1", "return 1;")).rejects.toThrow("playwright execution failed");
  });

  it("clicks by selector through playwright execution, and by coordinates through computer control", async () => {
    const client = createKernelClient("test-key");

    await client.click("sess_1", { selector: "#submit" });
    expect(fakeSdk.browsers.playwright.execute).toHaveBeenCalledWith(
      "sess_1",
      expect.objectContaining({ code: expect.stringContaining("#submit") }),
    );

    await client.click("sess_1", { x: 10, y: 20 });
    expect(fakeSdk.browsers.computer.clickMouse).toHaveBeenCalledWith("sess_1", { x: 10, y: 20 });
  });

  it("closes a session by deleting the Kernel browser", async () => {
    const client = createKernelClient("test-key");
    await client.close("sess_1");
    expect(fakeSdk.browsers.deleteByID).toHaveBeenCalledWith("sess_1");
  });

  it("maps replay start/stop/list onto the SDK's snake_case shape", async () => {
    const client = createKernelClient("test-key");

    const started = await client.startReplay("sess_1", { framerate: 15, maxDurationSeconds: 300, recordAudio: true });
    expect(fakeSdk.browsers.replays.start).toHaveBeenCalledWith("sess_1", {
      framerate: 15,
      max_duration_in_seconds: 300,
      record_audio: true,
    });
    expect(started).toEqual({
      replayId: "replay_1",
      replayViewUrl: null,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: null,
    });

    await client.stopReplay("sess_1", "replay_1");
    expect(fakeSdk.browsers.replays.stop).toHaveBeenCalledWith("replay_1", { id: "sess_1" });

    const replays = await client.listReplays("sess_1");
    expect(fakeSdk.browsers.replays.list).toHaveBeenCalledWith("sess_1");
    expect(replays).toEqual([
      {
        replayId: "replay_1",
        replayViewUrl: "https://replay.example/replay_1",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:05:00Z",
      },
    ]);
  });
});
