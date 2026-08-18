import Kernel from "@onkernel/sdk";
import type { ClickTarget, KernelBrowserClient, OpenOptions, OpenResult, SnapshotResult, TypeTarget } from "./types.js";

export function createKernelClient(apiKey: string): KernelBrowserClient {
  const kernel = new Kernel({ apiKey });

  async function execute(sessionId: string, code: string): Promise<unknown> {
    const response = await kernel.browsers.playwright.execute(sessionId, { code });
    if (!response.success) {
      throw new Error(response.error ?? "playwright execution failed");
    }
    return response.result;
  }

  return {
    async open(opts: OpenOptions): Promise<OpenResult> {
      const browser = await kernel.browsers.create({
        stealth: opts.stealth,
        headless: opts.headless ?? false,
        profile: opts.profileName ? { name: opts.profileName } : undefined,
        timeout_seconds: opts.timeoutSeconds,
        start_url: opts.url,
      });
      return {
        sessionId: browser.session_id,
        liveViewUrl: browser.browser_live_view_url ?? null,
        cdpWsUrl: browser.cdp_ws_url,
      };
    },

    async snapshot(sessionId: string): Promise<SnapshotResult> {
      const result = (await execute(
        sessionId,
        "return { url: page.url(), title: await page.title() };",
      )) as { url: string; title: string };
      return { url: result.url, title: result.title };
    },

    async click(sessionId: string, target: ClickTarget): Promise<void> {
      if (target.selector) {
        await execute(sessionId, `await page.click(${JSON.stringify(target.selector)});`);
        return;
      }
      if (target.x !== undefined && target.y !== undefined) {
        await kernel.browsers.computer.clickMouse(sessionId, { x: target.x, y: target.y });
        return;
      }
      throw new Error("click requires either a selector or x/y coordinates");
    },

    async type(sessionId: string, target: TypeTarget): Promise<void> {
      if (target.selector) {
        await execute(
          sessionId,
          `await page.fill(${JSON.stringify(target.selector)}, ${JSON.stringify(target.text)});`,
        );
        return;
      }
      await kernel.browsers.computer.typeText(sessionId, { text: target.text });
    },

    async evaluate(sessionId: string, script: string): Promise<unknown> {
      return execute(sessionId, script);
    },

    async close(sessionId: string): Promise<void> {
      await kernel.browsers.deleteByID(sessionId);
    },
  };
}
