import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as commands from "./commands.js";
import type { CommandContext } from "./commands.js";

const targetSchema = z.object({
  targetId: z.string(),
  threadId: z.string().nullable(),
  createdBy: z.enum(["cli", "agent"]),
  liveViewUrl: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
});

const replaySchema = z.object({
  replayId: z.string(),
  replayViewUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

const authConnectionSchema = z.object({
  connectionId: z.string(),
  domain: z.string(),
  profileName: z.string(),
  status: z.enum(["AUTHENTICATED", "NEEDS_AUTH"]),
  flowType: z.enum(["LOGIN", "REAUTH"]).nullable(),
  flowStatus: z.enum(["IN_PROGRESS", "SUCCESS", "FAILED", "EXPIRED", "CANCELED"]).nullable(),
  hostedUrl: z.string().nullable(),
  liveViewUrl: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  getTarget: {
    input: z.object({ targetId: z.string() }).strict(),
    output: z.object({ target: targetSchema.nullable() }),
  },
  close: {
    input: z.object({ targetId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  getReplay: {
    input: z.object({ targetId: z.string(), replayId: z.string() }).strict(),
    output: z.object({ replay: replaySchema.nullable() }),
  },
  getAuthConnection: {
    input: z.object({ connectionId: z.string() }).strict(),
    output: z.object({ connection: authConnectionSchema.nullable() }),
  },
});

export type TargetDto = z.infer<typeof targetSchema>;
export type ReplayDto = z.infer<typeof replaySchema>;
export type AuthConnectionDto = z.infer<typeof authConnectionSchema>;

export function registerRpc(bb: BbPluginApi, ctx: CommandContext): void {
  bb.rpc.register(rpcContract, {
    async getTarget({ targetId }) {
      const target = await commands.getTarget(ctx, targetId);
      return { target };
    },
    async close({ targetId }) {
      await commands.closeTarget(ctx, targetId);
      return { ok: true };
    },
    async getReplay({ targetId, replayId }) {
      const replay = await commands.getReplay(ctx, targetId, replayId);
      return { replay };
    },
    async getAuthConnection({ connectionId }) {
      try {
        const connection = await commands.getAuthConnection(ctx, connectionId);
        return { connection };
      } catch {
        return { connection: null };
      }
    },
  });
}
