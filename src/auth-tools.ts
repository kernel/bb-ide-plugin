import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";
import {
  DEFAULT_AUTH_WAIT_SECONDS,
  MAX_ALLOWED_DOMAINS,
  MAX_AUTH_WAIT_SECONDS,
  MAX_DOMAIN_LENGTH,
  MAX_LOGIN_URL_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
} from "./types.js";
import type { AuthConnectionSummary } from "./types.js";

interface CliCommandDescriptor {
  name: string;
  summary: string;
  usage: string;
}

export const AUTH_CLI_COMMANDS: CliCommandDescriptor[] = [
  {
    name: "auth-create",
    summary: "Create a managed auth connection for a profile and domain",
    usage: "bb kernel-browser auth-create <domain> --profile <name> [--login-url <url>] [--allowed-domains <a.com,b.com>] [--json]",
  },
  {
    name: "auth-list",
    summary: "List managed auth connections",
    usage: "bb kernel-browser auth-list [--domain <domain>] [--profile <name>] [--json]",
  },
  {
    name: "auth-get",
    summary: "Get a managed auth connection's current status",
    usage: "bb kernel-browser auth-get <connection-id> [--json]",
  },
  {
    name: "auth-login",
    summary: "Start a hosted login (or automatic re-auth) flow",
    usage: "bb kernel-browser auth-login <connection-id> [--json]",
  },
  {
    name: "auth-wait",
    summary: "Wait for a login flow to finish",
    usage: "bb kernel-browser auth-wait <connection-id> [--timeout <seconds>] [--json]",
  },
  {
    name: "auth-delete",
    summary: "Delete a managed auth connection",
    usage: "bb kernel-browser auth-delete <connection-id>",
  },
];

function authStatusText(connection: AuthConnectionSummary): string {
  const flow = connection.flowStatus ? ` (${connection.flowType ?? "?"} flow: ${connection.flowStatus})` : "";
  return `${connection.connectionId}  ${connection.domain}  profile=${connection.profileName}  status=${connection.status}${flow}`;
}

export function registerAuthTools(bb: BbPluginApi, ctx: CommandContext): void {
  bb.agents.registerTool({
    name: "kernel_auth_create",
    description:
      "Create a Kernel managed auth connection for a profile and domain. Creates the profile if it doesn't " +
      "exist yet. Call kernel_auth_list first — reuse an AUTHENTICATED connection instead of creating a new one.",
    parameters: z.object({
      domain: z.string().max(MAX_DOMAIN_LENGTH).describe("Target domain, e.g. 'netflix.com'"),
      profileName: z.string().max(MAX_PROFILE_NAME_LENGTH),
      loginUrl: z.string().max(MAX_LOGIN_URL_LENGTH).optional().describe("Login page URL to skip discovery"),
      allowedDomains: z
        .array(z.string())
        .max(MAX_ALLOWED_DOMAINS)
        .optional()
        .describe("Additional domains valid for this auth flow, e.g. redirect-based SSO domains"),
    }),
    async execute({ domain, profileName, loginUrl, allowedDomains }) {
      const connection = await commands.createAuthConnection(ctx, { domain, profileName, loginUrl, allowedDomains });
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_list",
    description: "List Kernel managed auth connections, optionally filtered by domain and/or profile name.",
    parameters: z.object({
      domain: z.string().max(MAX_DOMAIN_LENGTH).optional(),
      profileName: z.string().max(MAX_PROFILE_NAME_LENGTH).optional(),
    }),
    async execute({ domain, profileName }) {
      const connections = await commands.listAuthConnections(ctx, { domain, profileName });
      return connections.length ? connections.map(authStatusText).join("\n") : "no auth connections";
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_get",
    description: "Get a Kernel managed auth connection's current status and in-progress flow state, if any.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      const connection = await commands.getAuthConnection(ctx, connectionId);
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_login",
    description:
      "Start a login flow for a Kernel managed auth connection. Returns a hosted login URL for the user to " +
      "complete authentication themselves (Kernel's hosted UI collects the credentials, not this tool), or " +
      "triggers an automatic re-auth if credentials were already captured from a prior login.",
    instructions:
      "Put `::kernel-auth-login{connection-id=\"<connection-id>\"}` on its own line in your reply so the " +
      "hosted login page renders inline and the person can enter their own credentials there — never ask for " +
      "a password or code in chat, and never type one in yourself. Then call kernel_auth_wait for the same " +
      "connection to block until the flow finishes before continuing.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      const result = await commands.loginAuthConnection(ctx, connectionId);
      return result.hostedUrl
        ? `Started ${result.flowType} flow for ${result.connectionId}. Hosted login: ${result.hostedUrl}`
        : `Started ${result.flowType} flow for ${result.connectionId} (automatic re-auth in progress).`;
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_wait",
    description:
      "Block until a Kernel managed auth connection's in-progress login flow reaches a terminal state " +
      "(success, failure, expiry, or cancellation), or until the timeout elapses.",
    parameters: z.object({
      connectionId: z.string(),
      timeoutSeconds: z
        .number()
        .min(1)
        .max(MAX_AUTH_WAIT_SECONDS)
        .optional()
        .describe(`Seconds to wait, up to ${MAX_AUTH_WAIT_SECONDS} (default ${DEFAULT_AUTH_WAIT_SECONDS})`),
    }),
    async execute({ connectionId, timeoutSeconds }) {
      const connection = await commands.waitForAuthConnection(ctx, connectionId, timeoutSeconds);
      return authStatusText(connection);
    },
  });

  bb.agents.registerTool({
    name: "kernel_auth_delete",
    description: "Delete a Kernel managed auth connection and cancel any in-progress login flow.",
    parameters: z.object({ connectionId: z.string() }),
    async execute({ connectionId }) {
      await commands.deleteAuthConnection(ctx, connectionId);
      return "deleted";
    },
  });
}
