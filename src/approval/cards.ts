import type { Job, Proposal } from '../types.js';

/** Telegramのメッセージ上限は4096字。カード全体が収まるよう提案文の表示を制限する。 */
const MAX_PROPOSAL_DISPLAY = 2500;
const MAX_MESSAGE_LENGTH = 4000;

/** HTMLエスケープ(Telegram parse_mode: 'HTML' 用)。 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 承認依頼カードの本文を組み立てる。 */
export function buildApprovalCard(job: Job, proposal: Proposal): string {
  const truncated = proposal.content.length > MAX_PROPOSAL_DISPLAY;
  const displayContent = truncated
    ? `${proposal.content.slice(0, MAX_PROPOSAL_DISPLAY)}\n…(表示上限のため省略。全文はNotionに保存済み)`
    : proposal.content;
  const warning =
    proposal.content.length > 600
      ? `\n⚠️ <b>自己検査NG: 提案文が${proposal.content.length}字あります(推奨300〜500字)。編集で修正してください。</b>`
      : '';
  const competitionNote =
    job.proposalCount !== null ? ` / 既存提案 ${job.proposalCount}件以上` : '';
  const lines = [
    `<b>📋 応募承認リクエスト</b>`,
    ``,
    `<b>案件:</b> ${escapeHtml(job.title)}`,
    `<b>カテゴリ:</b> ${escapeHtml(job.category ?? '不明')}${competitionNote}`,
    `<b>予算:</b> ${escapeHtml(job.budgetText ?? '不明')} / <b>締切:</b> ${escapeHtml(job.deadline ?? '不明')}`,
    `<b>適合スコア:</b> ${job.fitScore ?? '-'} / 100`,
    `<b>判定理由:</b> ${escapeHtml(job.scoreReason ?? '-')}`,
    `<b>URL:</b> ${escapeHtml(job.url)}`,
    ``,
    `<b>📝 提案文 (v${proposal.version}, ${proposal.content.length}字)</b>${warning}`,
    `<blockquote>${escapeHtml(displayContent)}</blockquote>`,
  ];
  if (proposal.editInstruction) {
    lines.push(``, `<i>反映した修正指示: ${escapeHtml(proposal.editInstruction)}</i>`);
  }
  return clampMessage(lines.join('\n'));
}

/**
 * 最終ガード: HTMLタグの途中で切れると parse_mode: HTML が400を返すため、
 * 上限超過時は blockquote を閉じて切り詰める。
 */
function clampMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 20)}…</blockquote>`;
}

/** 承認後(手動送信モード)の案内文。 */
export function buildApprovedManualCard(job: Job): string {
  return [
    `<b>✅ 承認済み — 手動送信待ち</b>`,
    ``,
    `${escapeHtml(job.title)}`,
    `${escapeHtml(job.url)}`,
    ``,
    `上のURLを開き、最新の提案文を貼り付けて応募してください。`,
    `(提案文はこのメッセージの直前のカードからコピーできます)`,
    `送信したら下のボタンで記録してください。`,
  ].join('\n');
}

export function buildSkippedCard(job: Job): string {
  return `<b>⏭ スキップしました</b>\n${escapeHtml(job.title)}`;
}

export function buildSubmittedCard(job: Job): string {
  return `<b>🚀 応募済みとして記録しました</b>\n${escapeHtml(job.title)}\nNotionにも反映済みです。`;
}

export function buildEditPromptCard(job: Job): string {
  return [
    `<b>✏️ 編集モード</b>`,
    `${escapeHtml(job.title)}`,
    ``,
    `修正指示をこのチャットに返信してください。例:`,
    `「納期の速さをもっと強調して」`,
    `「RAGの実績を前面に出して」`,
    ``,
    `提案文そのものを送った場合は、その文章で差し替えます(「差し替え:」で始めてください)。`,
  ].join('\n');
}
