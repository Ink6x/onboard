import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/store/db.js';
import {
  insertJobIfNew,
  getJob,
  listJobsByStatus,
  updateJobStatus,
} from '../src/store/jobs.js';
import { insertProposal, getLatestProposal, listProposals } from '../src/store/proposals.js';

const CANDIDATE = {
  url: 'https://www.lancers.jp/work/detail/100',
  title: 'テスト案件',
  budgetText: '100,000円',
};

describe('jobs store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('新規案件を登録してJobとして取得できる', () => {
    const job = insertJobIfNew(db, CANDIDATE, 'dummy', null);
    expect(job).not.toBeNull();
    expect(job?.status).toBe('new');
    expect(job?.title).toBe('テスト案件');
  });

  it('同じURLは二重登録しない(冪等)', () => {
    insertJobIfNew(db, CANDIDATE, 'dummy', null);
    const second = insertJobIfNew(db, CANDIDATE, 'gmail', 'mail-1');
    expect(second).toBeNull();
    expect(listJobsByStatus(db, 'new')).toHaveLength(1);
  });

  it('状態遷移が永続化される', () => {
    const job = insertJobIfNew(db, CANDIDATE, 'dummy', null);
    updateJobStatus(db, job!.id, 'pending_approval');
    expect(getJob(db, job!.id)?.status).toBe('pending_approval');
  });
});

describe('proposals store', () => {
  it('バージョンが採番され、最新版を取得できる(旧版は不変)', () => {
    const db = openDb(':memory:');
    const job = insertJobIfNew(db, CANDIDATE, 'dummy', null);
    const v1 = insertProposal(db, job!.id, '初版の提案文', null);
    const v2 = insertProposal(db, job!.id, '修正版の提案文', '納期を強調');

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(getLatestProposal(db, job!.id)?.content).toBe('修正版の提案文');
    expect(listProposals(db, job!.id)).toHaveLength(2);
    expect(listProposals(db, job!.id)[0]?.content).toBe('初版の提案文');
  });
});
