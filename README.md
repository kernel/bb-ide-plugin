# bb-ide-plugin

Give [bb](https://github.com/get-bb/bb) a real browser. This plugin lets any
bb agent open a [Kernel](https://kernel.sh) cloud browser, watch it live, and
drive it — right from a thread, on your hosted bb workspace, no local
setup beyond an API key.

## Why you'd want this

Kernel gives any bb agent a real, cloud-hosted browser to work with. With
this plugin, an agent can:

- **Log into real accounts and get real work done** — check a dashboard,
  file a form, pull a report — on sites that need a real, cookie-carrying
  browser, not just an HTTP fetch.
- **Get past bot detection** that blocks plain scrapers, with stealth
  handling built in (`--stealth`).
- **Let you watch it happen.** Every session ships a live view URL you can
  open in a tab and watch the agent click around in real time — no more
  wondering what it's actually doing out there.
- **Keep running after you walk away.** The browser lives in the cloud, not
  in your editor. Close your laptop, resume the thread tomorrow, and the
  session (or its result) is still there.
- **Do all of this from a hosted bb workspace** — the browser is already
  cloud-hosted, so there's nothing to run locally and nothing tying the
  session to any one machine.

## What it adds

- `bb kernel-browser open|list|snapshot|click|type|eval|close|replay-start|replay-stop|replay-list`
  — see [`skills/kernel-browser/SKILL.md`](skills/kernel-browser/SKILL.md) for
  the full command reference.
- Native agent tools (`kernel_browser_open`, `_snapshot`, `_click`, `_type`,
  `_eval`, `_close`, `_replay_start`, `_replay_stop`, `_replay_list`) that wrap
  the same commands, so a session with native tool support doesn't need to
  shell out to the CLI.
- Video replays: record a target's session (`replay-start`), stop it to
  persist the video (`replay-stop`), and list past recordings with their
  view URLs (`replay-list`) — same target ownership rules as everything else.
- An inline live view: an agent's reply can include
  `::kernel-live{target-id="<target-id>"}` and bb renders it as an embedded
  iframe of that target's live view, right in the message — `kernel_browser_open`
  nudges the model to do this automatically.
- Target ownership tracking: every action is scoped to a target this plugin
  opened. Acting on an unknown or already-closed target fails with a clear
  error instead of silently doing nothing.
- Automatic cleanup: a thread's open targets are closed when the thread is
  archived or deleted, so Kernel sessions don't run (and bill) forever after
  a thread ends.

## Install

On your hosted bb workspace, you just need a
[Kernel API key](https://dashboard.onkernel.com/api-keys):

```bash
bb plugin install git:https://github.com/kernel/bb-ide-plugin.git@main
bb plugin config kernel-browser set apiKey <your-kernel-api-key>
bb plugin reload kernel-browser
```

Check status with `bb plugin list` — it reports `needs-configuration` until
`apiKey` is set. Once configured, ask any agent in the workspace to open a
browser and it's ready to go.

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
`git:` install runs automatically.

## Architecture

- `src/kernel-client.ts` — thin wrapper over `@onkernel/sdk`. Uses Kernel's
  Playwright Execution API (code runs server-side, in the same VM as the
  browser) for navigation/click/type/eval, and the Computer Use API for
  coordinate-based fallback actions. This avoids adding a CDP fingerprint on
  top of Kernel's own stealth handling.
- `src/store.ts` — the plugin's own SQLite table of open targets
  (`target_id`, `thread_id`, `created_by`, live view URL, timestamps), used
  to enforce that every command only acts on a target this plugin opened.
- `src/commands.ts` — the actual open/list/snapshot/click/type/eval/close/replay
  logic, shared by the CLI, the agent tools, and the RPC layer.
- `src/cli.ts`, `src/server.ts` — `bb.cli.register` / `bb.agents.registerTool`
  glue.
- `src/rpc.ts`, `app.tsx` — the `kernel-live` message directive's data plane
  (look up a target by id, close it) and UI (the embedded iframe).

## License

MIT
