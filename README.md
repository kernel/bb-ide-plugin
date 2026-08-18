# bb-plugin-kernel-browser

Drive [Kernel](https://kernel.sh) cloud browsers from [bb](https://github.com/get-bb/bb) —
CLI commands, native agent tools, and a thread panel live view.

bb (the agentic IDE) has no browser primitive of its own yet; its own
[`plans/bb-browser.md`](https://github.com/get-bb/bb/blob/main/plans/bb-browser.md)
proposes driving a local Electron `WebContentsView` tab over CDP so a user can
watch an agent browse. This plugin gets to the same outcome — an agent-driven
browser the user can watch live — without any of that: every Kernel session
ships its own live view URL, runs independently of bb's desktop app, survives
disconnects, and comes with stealth/anti-bot handling built in.

## What it adds

- `bb kernel-browser open|list|snapshot|click|type|eval|close` — see
  [`skills/kernel-browser/SKILL.md`](skills/kernel-browser/SKILL.md) for the
  full command reference.
- Native agent tools (`kernel_browser_open`, `_snapshot`, `_click`, `_type`,
  `_eval`, `_close`) that wrap the same commands, so a session with native
  tool support doesn't need to shell out to the CLI.
- A thread panel ("Kernel Browser") that iframes a target's live view URL,
  with a close button.
- A `::kernel-live-view{targetId="..."}` chat message directive — the
  `kernel_browser_open` agent tool returns it instead of a raw live view URL,
  so the agent's reply renders a "Watch live" control that opens the target
  in the Kernel Browser panel rather than a link that leaves the app.
- Target ownership tracking: every action is scoped to a target this plugin
  opened. Acting on an unknown or already-closed target fails with a clear
  error instead of silently doing nothing.
- Automatic cleanup: a thread's open targets are closed when the thread is
  archived or deleted, so Kernel sessions don't run (and bill) forever after
  a thread ends.

## Install

Requires a bb checkout with plugin support (`bb --version` >= 0.9) and a
[Kernel API key](https://dashboard.onkernel.com/api-keys).

```bash
bb plugin install git:https://github.com/kernel/bb-plugin-kernel-browser.git@main
bb plugin config kernel-browser set apiKey <your-kernel-api-key>
bb plugin reload kernel-browser
```

Or from a local checkout during development:

```bash
git clone https://github.com/kernel/bb-plugin-kernel-browser.git
bb plugin install path:./bb-plugin-kernel-browser
bb plugin config kernel-browser set apiKey <your-kernel-api-key>
bb plugin reload kernel-browser
```

Check status with `bb plugin list` — it reports `needs-configuration` until
`apiKey` is set.

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm test` runs the unit suite against `@get-bb/plugin-sdk/testing`'s fake
plugin host — no running bb server or live Kernel API key required; the
Kernel client is mocked. Against a real bb checkout, `bb plugin dev` (run
from this directory) watches sources and reloads the plugin on every save.

`bb plugin build` (no server required — it downloads its own build toolchain
on first use) compiles `dist/server.js` and `dist/app.js` and is what a
`git:`/`npm:` install runs automatically.

## Architecture

- `src/kernel-client.ts` — thin wrapper over `@onkernel/sdk`. Uses Kernel's
  Playwright Execution API (code runs server-side, in the same VM as the
  browser) for navigation/click/type/eval, and the Computer Use API for
  coordinate-based fallback actions. This avoids adding a CDP fingerprint on
  top of Kernel's own stealth handling.
- `src/store.ts` — the plugin's own SQLite table of open targets
  (`target_id`, `thread_id`, `created_by`, live view URL, timestamps), used
  to enforce that every command only acts on a target this plugin opened.
- `src/commands.ts` — the actual open/list/snapshot/click/type/eval/close
  logic, shared by the CLI, the agent tools, and the RPC layer.
- `src/cli.ts`, `src/server.ts` — `bb.cli.register` / `bb.agents.registerTool`
  glue.
- `src/rpc.ts`, `app.tsx` — the thread panel's data plane and UI.

## License

MIT
