import { Client } from '@notionhq/client';
import type Database from 'better-sqlite3';
import type { Job, JobStatus, Proposal } from '../types.js';
import { setJobNotionPageId } from '../store/jobs.js';

/** JobStatus → Notionの「ステータス」selectラベル */
export const STATUS_LABELS: Record<JobStatus, string> = {
  new: '新着',
  skipped_low_score: 'スキップ(低スコア)',
  notified_light: 'ライト通知',
  pending_approval: '承認待ち',
  editing: '編集中',
  approved: '承認済み',
  submitting: '送信確認待ち',
  submit_locked: '送信処理中',
  skipped_manual: 'スキップ(手動)',
  submitted: '応募済み',
  failed: '失敗',
};

/** 人間が手動で更新する欄(返信あり/受注/不採用)はシステムからは触らない。 */
export interface NotionProjection {
  syncJob(job: Job, proposal?: Proposal | null): Promise<void>;
}

/** Notion未設定でも側全体が動くように、no-op実装を返せるファクトリ。 */
export function createNotionProjection(
  token: string,
  databaseId: string,
  db: Database.Database,
): NotionProjection {
  if (!token || !databaseId) {
    console.warn('[notion] NOTION_TOKEN / NOTION_DATABASE_ID 未設定のため投影をスキップします');
    return { syncJob: async () => undefined };
  }

  const notion = new Client({ auth: token });

  return {
    async syncJob(job: Job, proposal?: Proposal | null): Promise<void> {
      const properties = buildProperties(job, proposal);
      try {
        if (job.notionPageId) {
          await notion.pages.update({ page_id: job.notionPageId, properties });
        } else {
          const page = await notion.pages.create({
            parent: { database_id: databaseId },
            properties,
          });
          setJobNotionPageId(db, job.id, page.id);
        }
      } catch (error) {
        // Notion障害でパイプラインを止めない(正はSQLite側にある)
        console.error(`[notion] sync failed for job #${job.id}:`, error);
      }
    },
  };
}

function buildProperties(job: Job, proposal?: Proposal | null) {
  return {
    案件名: { title: [{ text: { content: job.title.slice(0, 200) } }] },
    案件URL: { url: job.url },
    ステータス: { select: { name: STATUS_LABELS[job.status] } },
    適合スコア: { number: job.fitScore },
    予算: { rich_text: textChunks(job.budgetText ?? '') },
    判定理由: { rich_text: textChunks(job.scoreReason ?? '') },
    提案文: { rich_text: textChunks(proposal?.content ?? '') },
    メモ: { rich_text: textChunks(proposal?.editInstruction ?? '') },
    希望金額: { number: job.bidAmountYen },
    提示納期: job.bidDeliveryDays ? { rich_text: textChunks(`${job.bidDeliveryDays}日`) } : { rich_text: [] },
    送信結果: { rich_text: textChunks(submissionResultText(job)) },
    スクショパス: { rich_text: textChunks(job.screenshotPath ?? '') },
    // 応募日時はDB側で確定したタイムスタンプを使う(再同期で上書きされない)
    ...(job.submittedAt
      ? { 応募日時: { date: { start: new Date(`${job.submittedAt}Z`).toISOString() } } }
      : {}),
  };
}

/** 送信の結果サマリ(成功/失敗理由)を組み立てる。 */
function submissionResultText(job: Job): string {
  if (job.status === 'submitted') return '✅ 送信成功';
  if (job.submitError) return `❌ ${job.submitError}`;
  return '';
}

/** Notionのrich_textは1要素2000字制限のため分割する。 */
function textChunks(text: string): Array<{ text: { content: string } }> {
  if (!text) return [];
  const chunks: Array<{ text: { content: string } }> = [];
  for (let i = 0; i < text.length && i < 6000; i += 2000) {
    chunks.push({ text: { content: text.slice(i, i + 2000) } });
  }
  return chunks;
}
