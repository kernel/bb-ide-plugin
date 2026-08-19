---
name: kernel-browser
description: Drive a real, cloud-hosted Chrome browser via Kernel from a bb thread. Use whenever a task needs to load a page, read rendered content, fill a form, or otherwise act on the web — including sites with bot detection, or work that should keep running if this bb host goes away.
---

# Kernel Browser

`bb kernel-browser ...` opens and drives a [Kernel](https://kernel.sh) cloud
browser. Unlike a local headless browser, every session comes with a live
view URL the user can watch in real time, and the session keeps running
independently of this bb host — it survives disconnects and does not need a
desktop app window open.

## When to use this over other browser access

- Any task that needs to load a real page: read rendered content, check
  whether something shipped, fill in a form, log into a site.
- Sites protected by bot detection. Pass `--stealth` on `open`.
- Anything the user might want to watch. Share the `Watch it live:` URL
  `open` prints — don't just say "I opened a browser." Better still, put
  `::kernel-live{target-id="<target-id>"}` on its own line in your reply —
  bb renders it as an embedded live view right in the chat instead of just a
  link.
- Long-running or resumable work: the Kernel session outlives this thread's
  runtime, so a browser opened here is still there if the thread is resumed
  later. Always `close` it when the task is done so it doesn't run forever
  and rack up charges.

This is a separate cloud browser, not bb's own in-app browser tabs. Don't use
it to QA bb's own web app — use `dev-browser` or the ordinary in-app browser
for that.

## Commands

```
bb kernel-browser open [url] [--stealth] [--headless] [--profile <name>] [--timeout <seconds>] [--json]
bb kernel-browser list [--json]
bb kernel-browser snapshot <target-id> [--json]
bb kernel-browser click <target-id> --selector <css> | --x <n> --y <n>
bb kernel-browser type <target-id> --text <text> [--selector <css>]
bb kernel-browser eval <target-id> --script <code> | --script-file <path> [--json]
bb kernel-browser close <target-id>
```

`open` returns a `target-id` (a Kernel browser session id) plus a live view
URL when the session is headful (the default). Every other command operates
on a `target-id` returned by `open` — a plugin-owned target, not an arbitrary
Kernel session, so `click`/`type`/`eval`/`snapshot`/`close` fail with a clear
error against anything this plugin didn't open.

Native tools `kernel_browser_open`, `kernel_browser_snapshot`,
`kernel_browser_click`, `kernel_browser_type`, `kernel_browser_eval`, and
`kernel_browser_close` wrap the same commands — prefer the tools when
available; fall back to the CLI form when they aren't in this session's tool
set.

## Usage guidance

- Prefer `--selector` over `--x`/`--y` for `click` and `type`. Coordinates
  only make sense right after a `snapshot` told you where something is.
- `eval` runs a short Playwright script with `page` already in scope
  (`await page.goto(...)`, `return await page.title()`). Keep it small and
  explicit — it's for the rare case a selector-based action can't do the job,
  not a general escape hatch.
- Take a `snapshot` after a navigation or an action you're unsure landed,
  before deciding what to do next.
- `--json` on any command gives you a stable machine-readable shape; without
  it you get short human-readable text.
- `close` every target you open once the task is done, including on error
  paths. A thread ending (archived/deleted) also auto-closes its own targets,
  but don't rely on that for anything long-running.

## Configuration

Requires a Kernel API key: `bb plugin config kernel-browser set apiKey <key>`
(get one at https://dashboard.onkernel.com/api-keys), then
`bb plugin reload kernel-browser`. If the plugin reports
`needs-configuration` in `bb plugin list`, this hasn't been done yet — tell
the user rather than guessing at a key.
