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

export const rpcContract = defineRpcContract({
  latestForThread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ target: targetSchema.nullable() }),
  },
  close: {
    input: z.object({ targetId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

export type TargetDto = z.infer<typeof targetSchema>;

export function registerRpc(bb: BbPluginApi, ctx: CommandContext): void {
  bb.rpc.register(rpcContract, {
    async latestForThread({ threadId }) {
      const target = await commands.latestTargetForThread(ctx, threadId);
      return { target };
    },
    async close({ targetId }) {
      await commands.closeTarget(ctx, targetId);
      return { ok: true };
    },
  });
}
