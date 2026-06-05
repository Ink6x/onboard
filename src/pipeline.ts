import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Job, JobStatus, Proposal } from './types.js';
import type { Profile } from './generator/profile.js';
import type { ProposalGenerator, Scorer } from './generator/types.js';
import type { ApprovalHandlers } from './approval/bot.js';
import type { NotionProjection } from './projection/notion.js';
import {
  countSubmittedToday,
  getJob,
  listJobsByStatus,
  setJobTelegramMessageId,
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
  /** ユーザーへの通知(制限超過・警告など) */
  notify(text: string): Promise<void>;
}

/** 状態機械: 許可される遷移のホワイトリスト。逆行(submitted→editing等)を防ぐ。 */
const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  new: ['pending_approval', 'skipped_low_score', 'failed'],
  skipped_low_score: [],
  pending_approval: ['approved', 'editing', 'skipped_manual'],
  editing: ['pending_approval', 'skipped_manual'],
  approved: ['submitted', 'failed', 'skipped_manual'],
  skipped_manual: [],
  submitted: [],
  failed: ['pending_approval'], // 再試行を許可
};

/**
 * 状態遷移を一元化する(遷移検証+監査ログ+Notion投影を必ず伴わせる)。
 * 不正な遷移は拒否して null を返す(古いTelegramボタンの再押下など)。
 */
async function transition(
  deps: PipelineDeps,
  jobId: number,
  status: JobStatus,
  detail?: Record<string, unknown>,
): Promise<Job | null> {
  const current = getJob(deps.db, jobId);
  if (!current) return null;
  if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
    logEvent(deps.db, jobId, 'transition:rejected', { from: current.status, to: status });
    return null;
  }

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
  // 並行tickによる二重処理を防ぐ: 現在もnewであることを確認してから進める
  const fresh = getJob(deps.db, job.id);
  if (!fresh || fresh.status !== 'new') return;

  const score = deps.scorer.score(fresh, deps.profile);
  const scored = updateJobScore(deps.db, fresh.id, score.score, score.reason);
  logEvent(deps.db, fresh.id, 'job:scored', { score: score.score, reason: score.reason });
  if (!scored) return;

  if (score.score < deps.config.MIN_FIT_SCORE) {
    await transition(deps, fresh.id, 'skipped_low_score', { score: score.score });
    return;
  }

  const content = await deps.generator.generate(scored, deps.profile, score);
  const proposal = insertProposal(deps.db, fresh.id, content, null);
  logEvent(deps.db, fresh.id, 'proposal:generated', { version: proposal.version });

  const pending = await transition(deps, fresh.id, 'pending_approval');
  if (pending) {
    const messageId = await deps.sendApprovalCard(pending, proposal);
    setJobTelegramMessageId(deps.db, pending.id, messageId);
  }
}

/** 編集系操作を受け付けてよい状態か */
function isEditable(status: JobStatus): boolean {
  return status === 'pending_approval' || status === 'editing';
}

/** Telegramボットに渡す承認ハンドラー群を生成する。 */
export function createApprovalHandlers(deps: PipelineDeps): ApprovalHandlers {
  return {
    getJob: async (jobId) => getJob(deps.db, jobId),

    onApprove: async (jobId) => {
      // 日次レート制限: 当日の応募数が上限に達していたら承認を保留する
      const submittedToday = countSubmittedToday(deps.db);
      if (submittedToday >= deps.config.MAX_APPLICATIONS_PER_DAY) {
        await deps.notify(
          `⚠️ 本日の応募上限(${deps.config.MAX_APPLICATIONS_PER_DAY}件)に達しています。明日以降に承認してください。`,
        );
        logEvent(deps.db, jobId, 'approve:rate_limited', { submittedToday });
        return null;
      }
      return transition(deps, jobId, 'approved');
    },

    onSkip: async (jobId) => transition(deps, jobId, 'skipped_manual'),

    onEditInstruction: async (jobId, instruction) => {
      const job = getJob(deps.db, jobId);
      if (!job || !isEditable(job.status)) return null;
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
      if (!job || !isEditable(job.status)) return null;
      // editing状態を経由して再度pending_approvalへ(遷移検証を通すため)
      await transition(deps, jobId, 'editing', { mode: 'replace' });
      const proposal = insertProposal(deps.db, jobId, content, '手動差し替え');
      logEvent(deps.db, jobId, 'proposal:replaced', { version: proposal.version });
      const updated = await transition(deps, jobId, 'pending_approval');
      return updated ? { job: updated, proposal } : null;
    },

    onMarkSubmitted: async (jobId) => transition(deps, jobId, 'submitted'),
  };
}
