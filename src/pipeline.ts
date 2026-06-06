import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Job, JobStatus, Proposal } from './types.js';
import type { Profile } from './generator/profile.js';
import type { ProposalGenerator, Scorer } from './generator/types.js';
import type { ApprovalHandlers, ApproveOutcome, SubmitOutcome } from './approval/bot.js';
import type { NotionProjection } from './projection/notion.js';
import {
  countSubmittedToday,
  getJob,
  listJobsByStatus,
  setJobTelegramMessageId,
  updateJobDetail,
  updateJobScore,
  updateJobStatus,
  updateJobSubmission,
} from './store/jobs.js';
import { fetchJobDetail } from './collector/detailFetcher.js';
import { getLatestProposal, insertProposal } from './store/proposals.js';
import { logEvent } from './store/audit.js';
import { computeBidValues } from './submitter/bidValues.js';
import type { LancersSubmitter } from './submitter/submitter.js';
import { isWithinSubmitHours, randomSubmitDelayMs } from './submitter/guards.js';

export interface PipelineDeps {
  readonly db: Database.Database;
  readonly config: Config;
  readonly profile: Profile;
  readonly scorer: Scorer;
  readonly generator: ProposalGenerator;
  readonly notion: NotionProjection;
  /** 自動送信エンジン(SUBMIT_MODE=auto のときのみ非null) */
  readonly submitter: LancersSubmitter | null;
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
  approved: ['submitting', 'submitted', 'failed', 'skipped_manual', 'pending_approval'],
  submitting: ['submit_locked', 'skipped_manual', 'approved'],
  submit_locked: ['submitted', 'failed', 'approved'],
  skipped_manual: [],
  submitted: [],
  failed: ['pending_approval'], // 再試行を許可
};

/** 現在時刻を返す(テスト時に差し替え可能にするための間接化)。 */
function now(): Date {
  return new Date();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  let fresh = getJob(deps.db, job.id);
  if (!fresh || fresh.status !== 'new') return;

  // 案件詳細ページから依頼概要・提案数を取得する(スコア精度と提案文の質に直結)。
  // 失敗してもメール情報だけで続行する。
  if (!fresh.description && fresh.url.includes('lancers.jp/work/detail/')) {
    const detail = await fetchJobDetail(fresh.url);
    if (detail) {
      const enriched = updateJobDetail(deps.db, fresh.id, {
        description: detail.description,
        proposalCount: detail.proposalCount,
      });
      logEvent(deps.db, fresh.id, 'job:detail_fetched', {
        hasDescription: !!detail.description,
        proposalCount: detail.proposalCount,
      });
      if (enriched) fresh = enriched;
    }
  }

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

/** 当日の応募が上限に達しているか。 */
function isRateLimited(deps: PipelineDeps): boolean {
  return countSubmittedToday(deps.db) >= deps.config.MAX_APPLICATIONS_PER_DAY;
}

/** 送信を諦めて承認待ちへ戻し、新しい承認カードを送り直す(再試行の導線)。 */
async function revertToApproval(deps: PipelineDeps, jobId: number): Promise<void> {
  const reverted = await transition(deps, jobId, 'pending_approval', { reason: 'submit_reverted' });
  const proposal = getLatestProposal(deps.db, jobId);
  if (reverted && proposal) {
    const messageId = await deps.sendApprovalCard(reverted, proposal);
    setJobTelegramMessageId(deps.db, jobId, messageId);
  }
}

/**
 * 承認後の自動入力フロー(SUBMIT_MODE=auto)。
 * フォームへ自動入力しスクショを撮るところまで(送信はしない)。
 */
async function autoFill(deps: PipelineDeps, jobId: number): Promise<ApproveOutcome | null> {
  const submitter = deps.submitter;
  if (!submitter) return null;

  // 営業時間ガード
  const window = isWithinSubmitHours(deps.config, now());
  if (!window.allowed) {
    logEvent(deps.db, jobId, 'submit:outside_hours', { reason: window.reason });
    return { kind: 'blocked', message: `⏰ ${window.reason}。時間内に再度承認してください。` };
  }

  await transition(deps, jobId, 'approved');
  const job = getJob(deps.db, jobId);
  const proposal = getLatestProposal(deps.db, jobId);
  if (!job || !proposal) return null;

  const bid = computeBidValues(job, deps.profile);
  updateJobSubmission(deps.db, jobId, {
    bidAmountYen: bid.amountYen,
    bidDeliveryDays: bid.deliveryDays,
  });

  const result = await submitter.run(job, bid, proposal.content, 'fill');
  if (result.status === 'needs_login') {
    logEvent(deps.db, jobId, 'submit:needs_login');
    await revertToApproval(deps, jobId); // 承認待ちに戻して再試行可能にする
    return {
      kind: 'blocked',
      message: '🔑 Lancersのログインが切れています。<code>npm run lancers:login</code> を実行してから、届き直した承認カードで再度承認してください。',
    };
  }
  if (result.status === 'error') {
    updateJobSubmission(deps.db, jobId, { submitError: result.message, screenshotPath: result.screenshotPath });
    logEvent(deps.db, jobId, 'submit:fill_error', { message: result.message });
    await revertToApproval(deps, jobId);
    return { kind: 'blocked', message: `⚠️ フォーム自動入力に失敗しました: ${result.message}\n承認カードを送り直したので、修正・再承認できます。` };
  }

  // status === 'filled'
  updateJobSubmission(deps.db, jobId, { screenshotPath: result.screenshotPath });
  const filled = await transition(deps, jobId, 'submitting', { amount: bid.amountYen });
  if (!filled) return null;

  const caption = [
    `<b>📝 入力完了 — 最終確認</b>`,
    `${job.title}`,
    `希望金額: <b>${bid.amountYen.toLocaleString()}円</b>(${bid.rationale})`,
    `納期: ${bid.deliveryDays}日`,
    ``,
    `上の画面で内容を確認し、問題なければ「🚀 本当に送信」を押してください。`,
  ].join('\n');
  return { kind: 'filled', job: filled, screenshotPath: result.screenshotPath, caption };
}

/**
 * 起動時リカバリ: プロセスがsubmitting/submit_locked中にクラッシュした案件を
 * 承認待ちへ戻し、新しい承認カードを送り直す(古いボタンの再実行を防ぐ)。
 */
export async function recoverStuckJobs(deps: PipelineDeps): Promise<void> {
  const stuck = [...listJobsByStatus(deps.db, 'submitting'), ...listJobsByStatus(deps.db, 'submit_locked')];
  for (const job of stuck) {
    // submit_locked → approved → pending_approval(遷移ホワイトリストを通す)
    if (job.status === 'submit_locked') {
      await transition(deps, job.id, 'approved', { reason: 'startup_recovery' });
    }
    await revertToApproval(deps, job.id);
    logEvent(deps.db, job.id, 'recovery:reverted', { from: job.status });
  }
  if (stuck.length > 0) {
    await deps.notify(`🔄 起動時リカバリ: 送信途中だった ${stuck.length} 件を承認待ちに戻しました。`);
  }
}

/** Telegramボットに渡す承認ハンドラー群を生成する。 */
export function createApprovalHandlers(deps: PipelineDeps): ApprovalHandlers {
  return {
    getJob: async (jobId) => getJob(deps.db, jobId),

    onApprove: async (jobId): Promise<ApproveOutcome | null> => {
      // 日次レート制限: 当日の応募数が上限に達していたら承認を保留する
      if (isRateLimited(deps)) {
        logEvent(deps.db, jobId, 'approve:rate_limited');
        return {
          kind: 'blocked',
          message: `⚠️ 本日の応募上限(${deps.config.MAX_APPLICATIONS_PER_DAY}件)に達しています。明日以降に承認してください。`,
        };
      }

      // 自動送信モード: フォーム自動入力→最終確認へ
      if (deps.config.SUBMIT_MODE === 'auto' && deps.submitter) {
        return autoFill(deps, jobId);
      }

      // 手動送信モード: 承認済みにしてURLカードを返す
      const job = await transition(deps, jobId, 'approved');
      return job ? { kind: 'manual', job } : null;
    },

    onConfirmSubmit: async (jobId): Promise<SubmitOutcome | null> => {
      const submitter = deps.submitter;
      if (!submitter) return null;

      // 二重送信ガード: submitting → submit_locked へ即座に遷移し排他化する。
      // 同期的に走るため、2回目の確認タップはここで弾かれる(submit_lockedからは遷移不可)。
      const locked = await transition(deps, jobId, 'submit_locked');
      if (!locked) return null;

      // ロック後に営業時間・レート制限を再チェック(fillからsubmitまでに時間が経過しうる)
      const window = isWithinSubmitHours(deps.config, now());
      if (!window.allowed || isRateLimited(deps)) {
        const reason = !window.allowed
          ? window.reason
          : `本日の応募上限(${deps.config.MAX_APPLICATIONS_PER_DAY}件)に達しています`;
        await transition(deps, jobId, 'approved', { reason: 'submit_blocked_recheck' });
        logEvent(deps.db, jobId, 'submit:blocked_recheck', { reason });
        return { kind: 'error', message: `${reason}。承認カードから再度お試しください。`, screenshotPath: null };
      }

      const proposal = getLatestProposal(deps.db, jobId);
      if (!proposal) return null;

      // バースト送信を避けるためのランダム遅延
      await sleep(randomSubmitDelayMs(deps.config));

      const bid = computeBidValues(locked, deps.profile);
      const result = await submitter.run(locked, bid, proposal.content, 'submit');

      if (result.status === 'submitted') {
        updateJobSubmission(deps.db, jobId, { submitError: null, screenshotPath: result.screenshotPath });
        const submitted = await transition(deps, jobId, 'submitted', { amount: bid.amountYen });
        logEvent(deps.db, jobId, 'submit:success', { amount: bid.amountYen });
        return submitted
          ? { kind: 'submitted', job: submitted, screenshotPath: result.screenshotPath }
          : null;
      }

      const message =
        result.status === 'needs_login'
          ? 'ログインが切れています(npm run lancers:login)'
          : result.status === 'error'
            ? result.message
            : '不明なエラー';
      const screenshotPath = result.status === 'error' ? result.screenshotPath : null;
      updateJobSubmission(deps.db, jobId, { submitError: message, screenshotPath });
      await transition(deps, jobId, 'failed', { message });
      logEvent(deps.db, jobId, 'submit:failed', { message });
      return { kind: 'error', message, screenshotPath };
    },

    onAbortSubmit: async (jobId) => {
      const job = getJob(deps.db, jobId);
      if (!job || job.status !== 'submitting') return null;
      return transition(deps, jobId, 'skipped_manual', { reason: 'aborted_before_submit' });
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
