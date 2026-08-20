import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeSdk = {
  auth: {
    connections: {
      create: vi.fn(async () => ({
        id: "conn_1",
        domain: "example.com",
        profile_name: "my-profile",
        status: "NEEDS_AUTH",
        flow_type: null,
        flow_status: null,
        hosted_url: null,
        live_view_url: null,
      })),
      retrieve: vi.fn(async () => ({
        id: "conn_1",
        domain: "example.com",
        profile_name: "my-profile",
        status: "AUTHENTICATED",
        flow_type: "LOGIN",
        flow_status: "SUCCESS",
        hosted_url: null,
        live_view_url: null,
      })),
      list: vi.fn(async function* () {
        yield {
          id: "conn_1",
          domain: "example.com",
          profile_name: "my-profile",
          status: "AUTHENTICATED",
          flow_type: null,
          flow_status: null,
          hosted_url: null,
          live_view_url: null,
        };
      }),
      login: vi.fn(async () => ({
        id: "conn_1",
        flow_expires_at: "2026-01-01T00:10:00Z",
        flow_type: "LOGIN",
        hosted_url: "https://managed-auth.onkernel.com/flow/conn_1",
        live_view_url: "https://live.example/conn_1",
      })),
      delete: vi.fn(async () => {}),
    },
  },
};

class FakeKernel {
  auth = fakeSdk.auth;
}

vi.mock("@onkernel/sdk", () => ({ default: FakeKernel }));

const { createKernelAuthClient } = await import("../src/kernel-auth-client.js");

describe("createKernelAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps create params onto the SDK's snake_case shape and back", async () => {
    const client = createKernelAuthClient("test-key");
    const connection = await client.create({
      domain: "example.com",
      profileName: "my-profile",
      loginUrl: "https://example.com/login",
      allowedDomains: ["sso.example.com"],
    });

    expect(fakeSdk.auth.connections.create).toHaveBeenCalledWith({
      domain: "example.com",
      profile_name: "my-profile",
      login_url: "https://example.com/login",
      allowed_domains: ["sso.example.com"],
    });
    expect(connection).toEqual({
      connectionId: "conn_1",
      domain: "example.com",
      profileName: "my-profile",
      status: "NEEDS_AUTH",
      flowType: null,
      flowStatus: null,
      hostedUrl: null,
      liveViewUrl: null,
    });
  });

  it("retrieves a connection by id", async () => {
    const client = createKernelAuthClient("test-key");
    const connection = await client.get("conn_1");

    expect(fakeSdk.auth.connections.retrieve).toHaveBeenCalledWith("conn_1");
    expect(connection).toEqual({
      connectionId: "conn_1",
      domain: "example.com",
      profileName: "my-profile",
      status: "AUTHENTICATED",
      flowType: "LOGIN",
      flowStatus: "SUCCESS",
      hostedUrl: null,
      liveViewUrl: null,
    });
  });

  it("lists connections filtered by domain and profile name", async () => {
    const client = createKernelAuthClient("test-key");
    const connections = await client.list({ domain: "example.com", profileName: "my-profile" });

    expect(fakeSdk.auth.connections.list).toHaveBeenCalledWith({
      domain: "example.com",
      profile_name: "my-profile",
    });
    expect(connections).toHaveLength(1);
    expect(connections[0]?.connectionId).toBe("conn_1");
  });

  it("starts a login flow and maps the hosted url through", async () => {
    const client = createKernelAuthClient("test-key");
    const result = await client.login("conn_1");

    expect(fakeSdk.auth.connections.login).toHaveBeenCalledWith("conn_1");
    expect(result).toEqual({
      connectionId: "conn_1",
      flowType: "LOGIN",
      flowExpiresAt: "2026-01-01T00:10:00Z",
      hostedUrl: "https://managed-auth.onkernel.com/flow/conn_1",
      liveViewUrl: "https://live.example/conn_1",
    });
  });

  it("deletes a connection", async () => {
    const client = createKernelAuthClient("test-key");
    await client.delete("conn_1");
    expect(fakeSdk.auth.connections.delete).toHaveBeenCalledWith("conn_1");
  });
});
