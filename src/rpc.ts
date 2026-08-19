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
});

export type TargetDto = z.infer<typeof targetSchema>;
export type ReplayDto = z.infer<typeof replaySchema>;

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
  });
}
