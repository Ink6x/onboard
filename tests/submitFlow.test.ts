import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.js';
import { insertJobIfNew, getJob, updateJobStatus } from '../src/store/jobs.js';
import { insertProposal } from '../src/store/proposals.js';
import { createApprovalHandlers, type PipelineDeps } from '../src/pipeline.js';
import type { Profile } from '../src/generator/profile.js';
import type { Config } from '../src/config.js';
import type { LancersSubmitter, SubmitResult } from '../src/submitter/submitter.js';

const profile = {
  bidding: { budgetRatio: 0.9, fallbackAmountYen: 50000, deliveryDays: 30, minAmountYen: 30000 },
  works: [],
  skills: [],
  categories: [],
  ngKeywords: [],
  penaltyKeywords: [],
  conditions: { weeklyHours: '', responseSla: '', firstDraftDays: '' },
} as unknown as Profile;

const config = {
  SUBMIT_MODE: 'auto',
  MAX_APPLICATIONS_PER_DAY: 3,
  FULL_AUTO_SCORE: 70,
  LIGHT_NOTIFY_SCORE: 40,
  SUBMIT_HOURS_START: 0,
  SUBMIT_HOURS_END: 24,
  SUBMIT_DELAY_MIN_SEC: 0,
  SUBMIT_DELAY_MAX_SEC: 0,
} as Config;

function makeDeps(submitterRun: (stage: string) => SubmitResult) {
  const db = openDb(':memory:');
  const submitter = {
    run: vi.fn(async (_job, _bid, _text, stage: string) => submitterRun(stage)),
  } as unknown as LancersSubmitter;

  const deps: PipelineDeps = {
    db,
    config,
    profile,
    scorer: { score: () => ({ score: 80, reason: '', matchedWorks: [] }) },
    generator: { generate: async () => ({ content: 'x'.repeat(350), analysis: null }) },
    notion: { syncJob: async () => undefined },
    submitter,
    sendApprovalCard: async () => 1,
    sendLightCard: async () => 2,
    notify: async () => undefined,
  };
  return { db, deps, submitter };
}

function seedPendingJob(db: ReturnType<typeof openDb>): number {
  const job = insertJobIfNew(
    db,
    { url: 'https://www.lancers.jp/work/detail/1', title: 'テスト案件', budgetText: '100,000円 ～ 200,000円' },
    'dummy',
    null,
  );
  insertProposal(db, job!.id, 'x'.repeat(350), null);
  updateJobStatus(db, job!.id, 'pending_approval');
  return job!.id;
}

describe('2段階確認フロー', () => {
  it('承認でフォーム入力→submitting、確認で送信→submitted', async () => {
    const { db, deps } = makeDeps((stage) =>
      stage === 'fill'
        ? { status: 'filled', screenshotPath: '/tmp/fill.png' }
        : { status: 'submitted', screenshotPath: '/tmp/result.png' },
    );
    const handlers = createApprovalHandlers(deps);
    const jobId = seedPendingJob(db);

    const approve = await handlers.onApprove(jobId);
    expect(approve?.kind).toBe('filled');
    expect(getJob(db, jobId)?.status).toBe('submitting');
    expect(getJob(db, jobId)?.bidAmountYen).toBe(180000);

    const submit = await handlers.onConfirmSubmit(jobId);
    expect(submit?.kind).toBe('submitted');
    expect(getJob(db, jobId)?.status).toBe('submitted');
    expect(getJob(db, jobId)?.submittedAt).not.toBeNull();
  });

  it('二重confirmSubmitは2回目が弾かれる(submit_lockedから再ロック不可)', async () => {
    let runCount = 0;
    const { db, deps } = makeDeps((stage) => {
      if (stage === 'submit') runCount++;
      return stage === 'fill'
        ? { status: 'filled', screenshotPath: '/tmp/fill.png' }
        : { status: 'submitted', screenshotPath: '/tmp/result.png' };
    });
    const handlers = createApprovalHandlers(deps);
    const jobId = seedPendingJob(db);
    await handlers.onApprove(jobId);

    const [first, second] = await Promise.all([
      handlers.onConfirmSubmit(jobId),
      handlers.onConfirmSubmit(jobId),
    ]);
    const outcomes = [first?.kind, second?.kind];
    expect(outcomes.filter((k) => k === 'submitted')).toHaveLength(1);
    expect(outcomes.filter((k) => k === undefined)).toHaveLength(1); // 片方はnull
    expect(runCount).toBe(1); // 実送信は1回だけ
  });

  it('中止すると skipped_manual になり送信されない', async () => {
    const { db, deps, submitter } = makeDeps(() => ({ status: 'filled', screenshotPath: '/tmp/f.png' }));
    const handlers = createApprovalHandlers(deps);
    const jobId = seedPendingJob(db);
    await handlers.onApprove(jobId);

    const aborted = await handlers.onAbortSubmit(jobId);
    expect(aborted?.status).toBe('skipped_manual');
    // submitステージは呼ばれていない(fillの1回のみ)
    expect((submitter.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('needs_loginなら承認待ちへ戻る', async () => {
    const { db, deps } = makeDeps(() => ({ status: 'needs_login' }));
    const handlers = createApprovalHandlers(deps);
    const jobId = seedPendingJob(db);

    const approve = await handlers.onApprove(jobId);
    expect(approve?.kind).toBe('blocked');
    expect(getJob(db, jobId)?.status).toBe('pending_approval');
  });
});
