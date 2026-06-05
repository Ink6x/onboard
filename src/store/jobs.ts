import type Database from 'better-sqlite3';
import type { Job, JobCandidate, JobStatus } from '../types.js';

interface JobRow {
  id: number;
  source: string;
  email_id: string | null;
  url: string;
  title: string;
  description: string | null;
  budget_text: string | null;
  category: string | null;
  deadline: string | null;
  status: string;
  fit_score: number | null;
  score_reason: string | null;
  notion_page_id: string | null;
  telegram_message_id: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    source: row.source as Job['source'],
    emailId: row.email_id,
    url: row.url,
    title: row.title,
    description: row.description,
    budgetText: row.budget_text,
    category: row.category,
    deadline: row.deadline,
    status: row.status as JobStatus,
    fitScore: row.fit_score,
    scoreReason: row.score_reason,
    notionPageId: row.notion_page_id,
    telegramMessageId: row.telegram_message_id,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 案件候補を登録する。URLが既知なら何もしない(冪等)。
 * @returns 新規登録されたJob、既存だった場合はnull
 */
export function insertJobIfNew(
  db: Database.Database,
  candidate: JobCandidate,
  source: Job['source'],
  emailId: string | null,
): Job | null {
  // INSERT OR IGNORE + UNIQUE(url) で SELECT→INSERT 間のレースを排除する
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO jobs (source, email_id, url, title, description, budget_text, category, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source,
      emailId,
      candidate.url,
      candidate.title,
      candidate.description ?? null,
      candidate.budgetText ?? null,
      candidate.category ?? null,
      candidate.deadline ?? null,
    );
  if (result.changes === 0) return null;
  return getJob(db, Number(result.lastInsertRowid));
}

export function getJob(db: Database.Database, id: number): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function listJobsByStatus(db: Database.Database, status: JobStatus): readonly Job[] {
  const rows = db
    .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC')
    .all(status) as JobRow[];
  return rows.map(toJob);
}

export function updateJobStatus(db: Database.Database, id: number, status: JobStatus): Job | null {
  // submitted への初回遷移時のみ submitted_at を確定する(再同期で上書きされない)
  db.prepare(
    `UPDATE jobs SET status = ?,
       submitted_at = CASE WHEN ? = 'submitted' THEN COALESCE(submitted_at, datetime('now')) ELSE submitted_at END,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status, status, id);
  return getJob(db, id);
}

export function updateJobScore(
  db: Database.Database,
  id: number,
  fitScore: number,
  scoreReason: string,
): Job | null {
  db.prepare(
    `UPDATE jobs SET fit_score = ?, score_reason = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(fitScore, scoreReason, id);
  return getJob(db, id);
}

export function setJobNotionPageId(db: Database.Database, id: number, pageId: string): void {
  db.prepare(`UPDATE jobs SET notion_page_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
    pageId,
    id,
  );
}

export function setJobTelegramMessageId(
  db: Database.Database,
  id: number,
  messageId: number,
): void {
  db.prepare(
    `UPDATE jobs SET telegram_message_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(messageId, id);
}

/** 当日(ローカル日付)に submitted へ遷移した件数。日次レート制限の判定に使う。 */
export function countSubmittedToday(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE submitted_at IS NOT NULL
         AND date(submitted_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row.n;
}

/** メールを処理済みとして記録する。 @returns 新規記録ならtrue、既処理ならfalse */
export function markEmailProcessed(db: Database.Database, emailId: string): boolean {
  const result = db
    .prepare('INSERT OR IGNORE INTO processed_emails (email_id) VALUES (?)')
    .run(emailId);
  return result.changes > 0;
}

export function isEmailProcessed(db: Database.Database, emailId: string): boolean {
  return !!db.prepare('SELECT 1 FROM processed_emails WHERE email_id = ?').get(emailId);
}
