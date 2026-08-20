---
name: kernel-managed-auth
description: Get a Kernel profile logged into a website using Kernel's hosted login page, so a kernel-browser session opened with --profile can act on it as an authenticated user. Use before driving a site that requires an account, or when a kernel-browser session hits a login wall.
---

# Kernel Managed Auth

`bb kernel-browser auth-*` gets a Kernel profile authenticated against a
domain using Kernel's own hosted login page to collect credentials — this
plugin never sees, types, or stores a password or code itself.

## When to use this

- A task needs to act on a site behind a login, and no profile is already
  authenticated for it.
- A `kernel-browser` session hits a login wall mid-task.

Don't drive a login form yourself with `click`/`type` — use the hosted flow
below instead. It's stealth-safe, and Kernel captures the successful login so
later tasks can often skip straight to an automatic re-auth.

## Workflow

1. **Reuse before creating.** `bb kernel-browser auth-list --domain <domain>`
   first. If a connection with `status: AUTHENTICATED` already exists, skip to
   step 4 with its `profile_name`.
2. **Create a connection** if none exists:
   `bb kernel-browser auth-create <domain> --profile <name>`. Reuse an
   existing profile name if this task's browser sessions should share
   cookies/login state with it.
3. **Start the login flow:** `bb kernel-browser auth-login <connection-id>`.
   - Put `::kernel-auth-login{connection-id="<connection-id>"}` on its own
     line in your reply so the person watching sees the hosted login page
     embedded inline and can enter their own credentials there — never ask
     for a password or code in chat, and never type one in yourself.
   - End your turn on that reply. Don't immediately chain
     `auth-wait`/`auth-get` calls after posting the card — a reply that's
     mostly narration around more tool calls can end up visually collapsed
     as "work" in some hosts, burying the very card the person needs to act
     on. Check back in a separate step instead.
   - When you do check back (e.g. via `auth-wait`), and the flow is still
     `IN_PROGRESS`, **re-embed the same directive** in that reply too rather
     than telling the person to scroll up to "the page above" — it's the
     same live, auto-refreshing card, so re-embedding costs nothing and
     guarantees it's visible in the turn they're currently looking at.
   - If the flow seems stuck, wait it out (or let it expire) instead of
     calling `auth-login` again in a hurry. `auth-login` is safe to re-call —
     on a connection that's already `IN_PROGRESS` it reuses that flow instead
     of starting a competing one — but the hosted page a person already has
     open is tied to the *first* flow's one-time code, so restarting doesn't
     get them anything new to look at and just adds confusion.
4. **Hand off to the browser tools.** Once `auth-wait` reports
   `status: AUTHENTICATED`, open a browser against the same profile:
   `bb kernel-browser open <url> --profile <name>`. It's now a logged-in
   session — see the `kernel-browser` skill for driving it.

Kernel remembers the login and re-authenticates automatically on a schedule,
so step 3 is usually a one-time cost per profile — later tasks can jump
straight to step 4 once `auth-list`/`auth-get` reports `AUTHENTICATED`.

## Commands

```
bb kernel-browser auth-create <domain> --profile <name> [--login-url <url>] [--allowed-domains <a.com,b.com>] [--json]
bb kernel-browser auth-list [--domain <domain>] [--profile <name>] [--json]
bb kernel-browser auth-get <connection-id> [--json]
bb kernel-browser auth-login <connection-id> [--json]
bb kernel-browser auth-wait <connection-id> [--timeout <seconds>] [--json]
bb kernel-browser auth-delete <connection-id>
```

Native tools `kernel_auth_create`, `kernel_auth_list`, `kernel_auth_get`,
`kernel_auth_login`, `kernel_auth_wait`, and `kernel_auth_delete` wrap the
same commands — prefer them when available; fall back to the CLI form when
they aren't in this session's tool set.

`auth-login` returns a `hosted_url` when a human needs to complete the flow
(first-ever login, or a re-auth that needs a fresh MFA code), and no
`hosted_url` when Kernel is running an automatic re-auth in the background —
`auth-wait` handles either case the same way. A response with `reused: true`
means the connection already had a flow in progress and that flow's existing
`hosted_url` was returned rather than starting a new one.

## Configuration

Uses the same Kernel API key as `kernel-browser` — no separate setup.
