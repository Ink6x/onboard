/** 案件のライフサイクル状態 */
export const JOB_STATUSES = [
  'new', // メールから登録直後
  'skipped_low_score', // スコア閾値未満で自動スキップ
  'pending_approval', // Telegramで承認待ち
  'editing', // 編集指示を受けて再生成中
  'approved', // 承認済み(送信待ち)
  'submitting', // フォーム自動入力済み・最終送信確認待ち(2段階確認)
  'submit_locked', // 最終送信処理中(二重送信防止のロック)
  'skipped_manual', // Telegramで手動スキップ
  'submitted', // 応募送信済み
  'failed', // 送信失敗
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  readonly id: number;
  readonly source: 'gmail' | 'web' | 'dummy';
  readonly emailId: string | null;
  readonly url: string;
  readonly title: string;
  readonly description: string | null;
  readonly budgetText: string | null;
  readonly category: string | null;
  readonly deadline: string | null;
  readonly status: JobStatus;
  readonly fitScore: number | null;
  readonly scoreReason: string | null;
  readonly notionPageId: string | null;
  readonly telegramMessageId: number | null;
  readonly submittedAt: string | null;
  readonly proposalCount: number | null;
  readonly bidAmountYen: number | null; // 提示した希望金額
  readonly bidDeliveryDays: number | null; // 提示した納期
  readonly submitError: string | null; // 送信失敗時の理由
  readonly screenshotPath: string | null; // 最新の証跡スクショ
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** メールから抽出した、DB登録前の案件候補 */
export interface JobCandidate {
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly budgetText?: string;
  readonly category?: string;
  readonly deadline?: string;
}

export interface Proposal {
  readonly id: number;
  readonly jobId: number;
  readonly version: number;
  readonly content: string;
  readonly editInstruction: string | null;
  readonly createdAt: string;
}

export interface ScoreResult {
  readonly score: number; // 0-100
  readonly reason: string;
  readonly matchedWorks: readonly string[]; // 訴求に使うポートフォリオ実績名
}
