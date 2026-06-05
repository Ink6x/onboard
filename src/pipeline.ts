import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Job, Proposal } from './types.js';
import type { Profile } from './generator/profile.js';
import type { ProposalGenerator, Scorer } from './generator/types.js';
import type { ApprovalHandlers } from './approval/bot.js';
import type { NotionProjection } from './projection/notion.js';
import {
  getJob,
  listJobsByStatus,
  updateJobScore,
  updateJobStatus,
} from './store/jobs.js';
import { getLatestProposal, insertProposal } from './store/proposals.js';
import { logEvent } from './store/audit.js';

export interface PipelineDeps {
  readonly db: Database.Database;
  readonly config: Config;
  readonly profile: Profile;
  readonly scorer: Scorer;
  readonly generator: ProposalGenerator;
  readonly notion: NotionProjection;
  /** 承認待ちカードを送り、Telegram message_id を返す */
  sendApprovalCard(job: Job, proposal: Proposal): Promise<number>;
}

/** 状態遷移を一元化する(監査ログ+Notion投影を必ず伴わせる)。 */
async function transition(
  deps: PipelineDeps,
  jobId: number,
  status: Job['status'],
  detail?: Record<string, unknown>,
): Promise<Job | null> {
  const job = updateJobStatus(deps.db, jobId, status);
  logEvent(deps.db, jobId, `status:${status}`, detail);
  if (job) {
    const proposal = getLatestProposal(deps.db, jobId);
    await deps.notion.syncJob(job, proposal);
  }
  return job;
}

/**
 * status=new の案件を順に処理する:
 * スコアリング → 閾値未満は自動スキップ / 以上は提案文生成 → Telegram承認待ちへ
 */
export async function processNewJobs(deps: PipelineDeps): Promise<void> {
  const newJobs = listJobsByStatus(deps.db, 'new');
  for (const job of newJobs) {
    try {
      await processJob(deps, job);
    } catch (error) {
      console.error(`[pipeline] job #${job.id} の処理に失敗:`, error);
      logEvent(deps.db, job.id, 'pipeline:error', { message: String(error) });
    }
  }
}

async function processJob(deps: PipelineDeps, job: Job): Promise<void> {
  const score = deps.scorer.score(job, deps.profile);
  const scored = updateJobScore(deps.db, job.id, score.score, score.reason);
  logEvent(deps.db, job.id, 'job:scored', { score: score.score, reason: score.reason });
  if (!scored) return;

  if (score.score < deps.config.MIN_FIT_SCORE) {
    await transition(deps, job.id, 'skipped_low_score', { score: score.score });
    return;
  }

  const content = await deps.generator.generate(scored, deps.profile, score);
  const proposal = insertProposal(deps.db, job.id, content, null);
  logEvent(deps.db, job.id, 'proposal:generated', { version: proposal.version });

  const pending = await transition(deps, job.id, 'pending_approval');
  if (pending) {
    await deps.sendApprovalCard(pending, proposal);
  }
}

/** Telegramボットに渡す承認ハンドラー群を生成する。 */
export function createApprovalHandlers(deps: PipelineDeps): ApprovalHandlers {
  return {
    getJob: async (jobId) => getJob(deps.db, jobId),

    onApprove: async (jobId) => transition(deps, jobId, 'approved'),

    onSkip: async (jobId) => transition(deps, jobId, 'skipped_manual'),

    onEditInstruction: async (jobId, instruction) => {
      const job = getJob(deps.db, jobId);
      if (!job) return null;
      await transition(deps, jobId, 'editing', { instruction });

      const previous = getLatestProposal(deps.db, jobId);
      const score = deps.scorer.score(job, deps.profile);
      const content = await deps.generator.generate(
        job,
        deps.profile,
        score,
        instruction,
        previous?.content,
      );
      const proposal = insertProposal(deps.db, jobId, content, instruction);
      logEvent(deps.db, jobId, 'proposal:regenerated', {
        version: proposal.version,
        instruction,
      });

      const updated = await transition(deps, jobId, 'pending_approval');
      return updated ? { job: updated, proposal } : null;
    },

    onReplaceProposal: async (jobId, content) => {
      const job = getJob(deps.db, jobId);
      if (!job) return null;
      const proposal = insertProposal(deps.db, jobId, content, '手動差し替え');
      logEvent(deps.db, jobId, 'proposal:replaced', { version: proposal.version });
      const updated = await transition(deps, jobId, 'pending_approval');
      return updated ? { job: updated, proposal } : null;
    },

    onMarkSubmitted: async (jobId) => transition(deps, jobId, 'submitted'),
  };
}
