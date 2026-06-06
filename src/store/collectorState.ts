import type Database from 'better-sqlite3';

/**
 * Web巡回の永続状態(ローテーション位置・連続0件カウンタ等)のKVストア。
 * プロセス再起動でローテーションがリセットされないようにSQLiteに保持する。
 */

export function getCollectorState(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM collector_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setCollectorState(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO collector_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}
