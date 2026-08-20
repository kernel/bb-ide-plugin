import Kernel from "@onkernel/sdk";
import type {
  AuthConnectionSummary,
  AuthFlowStatus,
  AuthFlowType,
  CreateAuthConnectionOptions,
  KernelAuthClient,
  ListAuthConnectionsFilter,
  LoginFlowResult,
} from "./types.js";

interface KernelManagedAuth {
  id: string;
  domain: string;
  profile_name: string;
  status: "AUTHENTICATED" | "NEEDS_AUTH";
  flow_type?: AuthFlowType | null;
  flow_status?: AuthFlowStatus | null;
  hosted_url?: string | null;
  live_view_url?: string | null;
}

interface KernelLoginResponse {
  id: string;
  flow_expires_at: string;
  flow_type: AuthFlowType;
  hosted_url: string;
  live_view_url?: string;
}

function toSummary(auth: KernelManagedAuth): AuthConnectionSummary {
  return {
    connectionId: auth.id,
    domain: auth.domain,
    profileName: auth.profile_name,
    status: auth.status,
    flowType: auth.flow_type ?? null,
    flowStatus: auth.flow_status ?? null,
    hostedUrl: auth.hosted_url ?? null,
    liveViewUrl: auth.live_view_url ?? null,
  };
}

function toLoginResult(response: KernelLoginResponse): LoginFlowResult {
  return {
    connectionId: response.id,
    flowType: response.flow_type,
    flowExpiresAt: response.flow_expires_at,
    hostedUrl: response.hosted_url ?? null,
    liveViewUrl: response.live_view_url ?? null,
  };
}

export function createKernelAuthClient(apiKey: string): KernelAuthClient {
  const kernel = new Kernel({ apiKey });

  return {
    async create(opts: CreateAuthConnectionOptions): Promise<AuthConnectionSummary> {
      const connection = await kernel.auth.connections.create({
        domain: opts.domain,
        profile_name: opts.profileName,
        login_url: opts.loginUrl,
        allowed_domains: opts.allowedDomains,
      });
      return toSummary(connection);
    },

    async get(connectionId: string): Promise<AuthConnectionSummary> {
      const connection = await kernel.auth.connections.retrieve(connectionId);
      return toSummary(connection);
    },

    async list(filter: ListAuthConnectionsFilter): Promise<AuthConnectionSummary[]> {
      const connections: AuthConnectionSummary[] = [];
      for await (const connection of kernel.auth.connections.list({
        domain: filter.domain,
        profile_name: filter.profileName,
      })) {
        connections.push(toSummary(connection));
      }
      return connections;
    },

    async login(connectionId: string): Promise<LoginFlowResult> {
      const response = await kernel.auth.connections.login(connectionId);
      return toLoginResult(response);
    },

    async delete(connectionId: string): Promise<void> {
      await kernel.auth.connections.delete(connectionId);
    },
  };
}
