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

/** 当日(ローカル日付)のカウンタを返す。別日付の値は0扱い。 */
export function getDailyCount(db: Database.Database, prefix: string): number {
  const raw = getCollectorState(db, dailyKey(prefix));
  return raw ? Number(raw) : 0;
}

/** 当日カウンタをn増やして新しい値を返す(日次ログイン上限の判定に使う)。 */
export function incrementDailyCount(db: Database.Database, prefix: string, n = 1): number {
  const next = getDailyCount(db, prefix) + n;
  setCollectorState(db, dailyKey(prefix), String(next));
  return next;
}

/** prefix:YYYY-MM-DD 形式のキー(SQLiteのlocaltimeでローカル日付に揃える)。 */
function dailyKey(prefix: string): string {
  const row = db_dateNow();
  return `${prefix}:${row}`;
}

// localtimeの当日文字列を得るためのヘルパー(呼び出し側DBに依存しない簡易版)
function db_dateNow(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
