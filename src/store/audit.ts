import type Database from 'better-sqlite3';

/** すべての状態遷移・外部副作用を監査ログに記録する。 */
export function logEvent(
  db: Database.Database,
  jobId: number | null,
  event: string,
  detail?: Record<string, unknown>,
): void {
  db.prepare('INSERT INTO audit_log (job_id, event, detail) VALUES (?, ?, ?)').run(
    jobId,
    event,
    detail ? JSON.stringify(detail) : null,
  );
}
