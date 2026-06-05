import type Database from 'better-sqlite3';
import type { Proposal } from '../types.js';

interface ProposalRow {
  id: number;
  job_id: number;
  version: number;
  content: string;
  edit_instruction: string | null;
  created_at: string;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    jobId: row.job_id,
    version: row.version,
    content: row.content,
    editInstruction: row.edit_instruction,
    createdAt: row.created_at,
  };
}

/** 新しいバージョンとして提案文を保存する(既存版は不変のまま履歴に残る)。 */
export function insertProposal(
  db: Database.Database,
  jobId: number,
  content: string,
  editInstruction: string | null,
): Proposal {
  const latest = db
    .prepare('SELECT MAX(version) AS v FROM proposals WHERE job_id = ?')
    .get(jobId) as { v: number | null };
  const version = (latest.v ?? 0) + 1;
  const result = db
    .prepare(
      'INSERT INTO proposals (job_id, version, content, edit_instruction) VALUES (?, ?, ?, ?)',
    )
    .run(jobId, version, content, editInstruction);
  const row = db
    .prepare('SELECT * FROM proposals WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ProposalRow;
  return toProposal(row);
}

export function getLatestProposal(db: Database.Database, jobId: number): Proposal | null {
  const row = db
    .prepare('SELECT * FROM proposals WHERE job_id = ? ORDER BY version DESC LIMIT 1')
    .get(jobId) as ProposalRow | undefined;
  return row ? toProposal(row) : null;
}

export function listProposals(db: Database.Database, jobId: number): readonly Proposal[] {
  const rows = db
    .prepare('SELECT * FROM proposals WHERE job_id = ? ORDER BY version ASC')
    .all(jobId) as ProposalRow[];
  return rows.map(toProposal);
}
