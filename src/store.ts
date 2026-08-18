import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { KernelTarget, TargetOrigin } from "./types.js";

interface TargetRow {
  target_id: string;
  thread_id: string | null;
  created_by: string;
  live_view_url: string | null;
  cdp_ws_url: string;
  created_at: number;
  last_used_at: number;
}

export interface TargetStore {
  insert(target: KernelTarget): void;
  touch(targetId: string): void;
  get(targetId: string): KernelTarget | null;
  listByThread(threadId: string): KernelTarget[];
  listAll(): KernelTarget[];
  remove(targetId: string): void;
}

function toTarget(row: TargetRow): KernelTarget {
  return {
    targetId: row.target_id,
    threadId: row.thread_id,
    createdBy: row.created_by as TargetOrigin,
    liveViewUrl: row.live_view_url,
    cdpWsUrl: row.cdp_ws_url,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function createTargetStore(bb: BbPluginApi): TargetStore {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS targets (
      target_id TEXT PRIMARY KEY,
      thread_id TEXT,
      created_by TEXT NOT NULL,
      live_view_url TEXT,
      cdp_ws_url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )`,
  ]);

  return {
    insert(target) {
      db.prepare(
        `INSERT INTO targets (target_id, thread_id, created_by, live_view_url, cdp_ws_url, created_at, last_used_at)
         VALUES (@targetId, @threadId, @createdBy, @liveViewUrl, @cdpWsUrl, @createdAt, @lastUsedAt)`,
      ).run({
        targetId: target.targetId,
        threadId: target.threadId,
        createdBy: target.createdBy,
        liveViewUrl: target.liveViewUrl,
        cdpWsUrl: target.cdpWsUrl,
        createdAt: target.createdAt,
        lastUsedAt: target.lastUsedAt,
      });
    },

    touch(targetId) {
      db.prepare(`UPDATE targets SET last_used_at = ? WHERE target_id = ?`).run(Date.now(), targetId);
    },

    get(targetId) {
      const row = db.prepare(`SELECT * FROM targets WHERE target_id = ?`).get(targetId) as
        | TargetRow
        | undefined;
      return row ? toTarget(row) : null;
    },

    listByThread(threadId) {
      const rows = db
        .prepare(`SELECT * FROM targets WHERE thread_id = ? ORDER BY created_at DESC`)
        .all(threadId) as TargetRow[];
      return rows.map(toTarget);
    },

    listAll() {
      const rows = db.prepare(`SELECT * FROM targets ORDER BY created_at DESC`).all() as TargetRow[];
      return rows.map(toTarget);
    },

    remove(targetId) {
      db.prepare(`DELETE FROM targets WHERE target_id = ?`).run(targetId);
    },
  };
}
