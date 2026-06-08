import type { JobAnalysis } from '../generator/analysis.js';
import type { Job, ScoreResult } from '../types.js';

/**
 * 手動提案文生成CLI(scripts/propose.ts)の出力層。
 * 提案文に加え、Stage1分析・スコア・マッチ実績を併記したMarkdownを組み立てる。
 */

export interface ProposalReport {
  readonly job: Job;
  readonly score: ScoreResult;
  readonly analysis: JobAnalysis | null;
  readonly proposal: string;
  readonly issues: readonly string[];
  readonly generatedAt: string;
}

const LENGTH_LABELS: Record<JobAnalysis['recommendedLength'], string> = {
  short: 'short(400〜600字)',
  medium: 'medium(600〜1000字)',
  long: 'long(1000〜1600字)',
};

function joinOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(' / ') : '(なし)';
}

/** 提案文+分析情報のMarkdownレポートを組み立てる(純関数)。 */
export function renderProposalMarkdown(report: ProposalReport): string {
  const { job, score, analysis, proposal, issues, generatedAt } = report;

  const analysisSection = analysis
    ? [
        '## 案件分析 (Stage 1)',
        '',
        `- クライアントのゴール: ${analysis.clientGoal}`,
        `- 悩み・不安: ${joinOrNone(analysis.painPoints)}`,
        `- 求められる人物像: ${analysis.idealCandidate}`,
        `- 必須対応事項: ${joinOrNone(analysis.mustAddress)}`,
        `- 共感の切り口: ${joinOrNone(analysis.empathyHooks)}`,
        `- 適正分量: ${LENGTH_LABELS[analysis.recommendedLength]}`,
        `- 不確実な点: ${joinOrNone(analysis.uncertainties)}`,
      ].join('\n')
    : '## 案件分析 (Stage 1)\n\n(分析なし: Stage 1が失敗したため、執筆のみで生成されました)';

  return [
    `# 提案文: ${job.title}`,
    '',
    `- 生成日時: ${generatedAt}`,
    `- URL: ${job.url || '(なし)'}`,
    `- スコア: ${score.score} (${score.reason})`,
    `- マッチした実績: ${score.matchedWorks.length > 0 ? score.matchedWorks.join(', ') : '(なし)'}`,
    `- 自己検査: ${issues.length === 0 ? 'OK' : issues.join(' / ')}`,
    '',
    `## 提案文 (${proposal.length}字)`,
    '',
    proposal,
    '',
    analysisSection,
    '',
    '## 案件情報',
    '',
    `- カテゴリ: ${job.category ?? '不明'}`,
    `- 予算: ${job.budgetText ?? '不明'}`,
    `- 募集締切: ${job.deadline ?? '不明'}`,
    `- 既存提案数: ${job.proposalCount !== null ? `${job.proposalCount}件以上` : '不明'}`,
    '',
    '### 依頼概要',
    '',
    job.description ?? '(未取得)',
    '',
  ].join('\n');
}

const MAX_SLUG_CHARS = 30;

/** `YYYYMMDD-HHmmss-<タイトルスラグ>.md` 形式のファイル名を返す。 */
export function proposalFileName(title: string, now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // Windowsで使えない文字・記号類を除去し、連続ハイフンを畳む
  // (ゼロ幅文字・双方向制御文字は見た目で区別できないファイル名を生むため先に除去)
  const slug = title
    .replace(/[\u200B-\u200F\uFEFF\u202A-\u202E]/g, '')
    .replace(/[\\/:*?"<>|\s【】\[\]()()、。・,，]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_CHARS);
  return slug.length > 0 ? `${stamp}-${slug}.md` : `${stamp}.md`;
}
