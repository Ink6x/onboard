import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/store/db.js';
import { insertJobIfNew, getJob } from '../src/store/jobs.js';
import { getLatestProposal } from '../src/store/proposals.js';
import { createApprovalHandlers, processNewJobs, type PipelineDeps } from '../src/pipeline.js';
import type { Profile } from '../src/generator/profile.js';
import type { Config } from '../src/config.js';

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
  SUBMIT_MODE: 'manual',
  MAX_APPLICATIONS_PER_DAY: 3,
  FULL_AUTO_SCORE: 70,
  LIGHT_NOTIFY_SCORE: 40,
  SUBMIT_HOURS_START: 0,
  SUBMIT_HOURS_END: 24,
  SUBMIT_DELAY_MIN_SEC: 0,
  SUBMIT_DELAY_MAX_SEC: 0,
} as Config;

interface MakeDepsOptions {
  score: number;
  generateDelayMs?: number;
}

function makeDeps(options: MakeDepsOptions) {
  const db = openDb(':memory:');
  const generate = vi.fn(async () => {
    if (options.generateDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.generateDelayMs));
    }
    return { content: 'x'.repeat(350), analysis: null };
  });
  const sendApprovalCard = vi.fn(async () => 100);
  const sendLightCard = vi.fn(async () => 200);

  const deps: PipelineDeps = {
    db,
    config,
    profile,
    scorer: { score: () => ({ score: options.score, reason: 'テスト', matchedWorks: [] }) },
    generator: { generate },
    notion: { syncJob: async () => undefined },
    submitter: null,
    sendApprovalCard,
    sendLightCard,
    notify: async () => undefined,
  };
  return { db, deps, generate, sendApprovalCard, sendLightCard };
}

/** descriptionを入れて登録する(詳細フェッチのネットワークアクセスを発生させない)。 */
function seedNewJob(db: ReturnType<typeof openDb>): number {
  const job = insertJobIfNew(
    db,
    {
      url: 'https://www.lancers.jp/work/detail/9999',
      title: 'テスト案件',
      description: 'テスト用の依頼概要',
      budgetText: '100,000円 ～ 200,000円',
    },
    'dummy',
    null,
  );
  return job!.id;
}

describe('2段階ティア: processNewJobs', () => {
  it('FULL_AUTO_SCORE以上は提案文を生成して承認カードを送る', async () => {
    const { db, deps, generate, sendApprovalCard, sendLightCard } = makeDeps({ score: 80 });
    const jobId = seedNewJob(db);

    await processNewJobs(deps);

    expect(getJob(db, jobId)?.status).toBe('pending_approval');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sendApprovalCard).toHaveBeenCalledTimes(1);
    expect(sendLightCard).not.toHaveBeenCalled();
  });

  it('中間スコアは生成せずライトカードのみ送る(トークン消費ゼロ)', async () => {
    const { db, deps, generate, sendApprovalCard, sendLightCard } = makeDeps({ score: 55 });
    const jobId = seedNewJob(db);

    await processNewJobs(deps);

    expect(getJob(db, jobId)?.status).toBe('notified_light');
    expect(generate).not.toHaveBeenCalled();
    expect(sendApprovalCard).not.toHaveBeenCalled();
    expect(sendLightCard).toHaveBeenCalledTimes(1);
    expect(getJob(db, jobId)?.telegramMessageId).toBe(200);
  });

  it('LIGHT_NOTIFY_SCORE未満はサイレントスキップする', async () => {
    const { db, deps, generate, sendApprovalCard, sendLightCard } = makeDeps({ score: 30 });
    const jobId = seedNewJob(db);

    await processNewJobs(deps);

    expect(getJob(db, jobId)?.status).toBe('skipped_low_score');
    expect(generate).not.toHaveBeenCalled();
    expect(sendApprovalCard).not.toHaveBeenCalled();
    expect(sendLightCard).not.toHaveBeenCalled();
  });
});

describe('2段階ティア: 興味ありボタン(onInterest)', () => {
  async function seedLightNotified(options: MakeDepsOptions) {
    const made = makeDeps(options);
    const jobId = seedNewJob(made.db);
    await processNewJobs(made.deps); // notified_light まで進める
    return { ...made, jobId };
  }

  it('notified_lightの案件に提案文を生成し承認待ちへ進める', async () => {
    const { db, deps, generate, sendApprovalCard, jobId } = await seedLightNotified({ score: 55 });
    const handlers = createApprovalHandlers(deps);

    const outcome = await handlers.onInterest(jobId);

    expect(outcome?.kind).toBe('generated');
    expect(getJob(db, jobId)?.status).toBe('pending_approval');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sendApprovalCard).toHaveBeenCalledTimes(1);
    expect(getLatestProposal(db, jobId)).not.toBeNull();
  });

  it('notified_light以外の状態ではnullを返す', async () => {
    const { db, deps } = makeDeps({ score: 80 });
    const jobId = seedNewJob(db);
    await processNewJobs(deps); // pending_approval まで進む
    const handlers = createApprovalHandlers(deps);

    expect(await handlers.onInterest(jobId)).toBeNull();
  });

  it('生成中の二重押下は2回目がbusyになり生成は1回だけ', async () => {
    const { deps, generate, jobId } = await seedLightNotified({ score: 55, generateDelayMs: 50 });
    const handlers = createApprovalHandlers(deps);

    const [first, second] = await Promise.all([
      handlers.onInterest(jobId),
      handlers.onInterest(jobId),
    ]);

    const kinds = [first?.kind, second?.kind];
    expect(kinds.filter((k) => k === 'generated')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'busy')).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('生成失敗時はnotified_lightに留まり再試行できる', async () => {
    const { db, deps, jobId } = await seedLightNotified({ score: 55 });
    deps.generator.generate = vi.fn(async () => {
      throw new Error('API error');
    });
    const handlers = createApprovalHandlers(deps);

    const outcome = await handlers.onInterest(jobId);

    expect(outcome?.kind).toBe('error');
    expect(getJob(db, jobId)?.status).toBe('notified_light');
  });

  it('承認カード送信失敗時はnotified_lightに留まる(孤児pending_approvalを作らない)', async () => {
    const { db, deps, jobId } = await seedLightNotified({ score: 55 });
    const failingSend = vi.fn(async () => {
      throw new Error('Telegram API down');
    });
    const mutableDeps = { ...deps, sendApprovalCard: failingSend };
    const handlers = createApprovalHandlers(mutableDeps);

    const outcome = await handlers.onInterest(jobId);

    expect(outcome?.kind).toBe('error');
    expect(getJob(db, jobId)?.status).toBe('notified_light'); // 再試行可能な状態のまま

    // 復旧後の再押下で正常に承認待ちまで進める
    const retried = await createApprovalHandlers(deps).onInterest(jobId);
    expect(retried?.kind).toBe('generated');
    expect(getJob(db, jobId)?.status).toBe('pending_approval');
  });

  it('ライトカード送信失敗時はnewに留まり次tickで再試行される', async () => {
    const { db, deps } = makeDeps({ score: 55 });
    const jobId = seedNewJob(db);
    const mutableDeps = {
      ...deps,
      sendLightCard: vi.fn(async () => {
        throw new Error('Telegram API down');
      }),
    };

    await processNewJobs(mutableDeps); // エラーはprocessNewJobs内で捕捉される

    expect(getJob(db, jobId)?.status).toBe('new'); // 次tickの再処理対象のまま

    await processNewJobs(deps); // 復旧後のtick
    expect(getJob(db, jobId)?.status).toBe('notified_light');
  });

  it('スキップボタンはnotified_lightからも使える', async () => {
    const { db, deps, jobId } = await seedLightNotified({ score: 55 });
    const handlers = createApprovalHandlers(deps);

    const skipped = await handlers.onSkip(jobId);

    expect(skipped?.status).toBe('skipped_manual');
    expect(getJob(db, jobId)?.status).toBe('skipped_manual');
  });
});
