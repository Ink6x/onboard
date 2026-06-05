import type { JobCandidate } from '../types.js';

/**
 * Lancers通知メールの本文(プレーンテキスト)から案件候補を抽出する。
 *
 * 注意: Lancersのメールフォーマットは公式非公開のため、このパーサーは
 * 「案件詳細URL(lancers.jp/work/detail/ID)の周辺行からタイトル・予算を拾う」
 * という汎用ヒューリスティックで実装している。
 * 実メールのサンプル入手後、tests/fixtures/ にフィクスチャを追加して精度を上げること。
 */

const WORK_URL_PATTERN = /https?:\/\/(?:www\.)?lancers\.jp\/work\/detail\/(\d+)\S*/g;
const BUDGET_PATTERN = /(?:予算|報酬|金額)[::\s]*([^\n]+)|([\d,]+\s*円\s*[~〜-]\s*[\d,]+\s*円)|([\d,]+\s*円)/;
const CONTEXT_LINES = 4;

/** URLのクエリ等を除いた正規形(冪等性キー)に変換する。 */
export function canonicalWorkUrl(workId: string): string {
  return `https://www.lancers.jp/work/detail/${workId}`;
}

export function parseLancersEmail(plainTextBody: string): readonly JobCandidate[] {
  const lines = plainTextBody.split(/\r?\n/);
  const candidates: JobCandidate[] = [];
  const seenIds = new Set<string>();

  lines.forEach((line, index) => {
    for (const match of line.matchAll(WORK_URL_PATTERN)) {
      const workId = match[1];
      if (!workId || seenIds.has(workId)) continue;
      seenIds.add(workId);

      const context = lines.slice(Math.max(0, index - CONTEXT_LINES), index);
      const title = extractTitle(context) ?? `Lancers案件 ${workId}`;
      const budgetText = extractBudget([...context, line]);

      candidates.push({
        url: canonicalWorkUrl(workId),
        title,
        ...(budgetText ? { budgetText } : {}),
      });
    }
  });

  return candidates;
}

/** URL直前の「URLでも区切り線でもない最も近い非空行」をタイトルとみなす。 */
function extractTitle(contextLines: readonly string[]): string | null {
  for (let i = contextLines.length - 1; i >= 0; i--) {
    const line = (contextLines[i] ?? '').trim();
    if (!line) continue;
    if (/^https?:\/\//.test(line)) continue;
    if (/^[-=_*■□▼▽─━]+$/.test(line)) continue;
    if (BUDGET_PATTERN.test(line) && line.length < 30) continue; // 予算だけの行はタイトルにしない
    return cleanTitle(line);
  }
  return null;
}

function cleanTitle(line: string): string {
  // 行頭の装飾記号と半角角括弧のみ除去する(【】は案件タイトルの一部なので残す)
  return line
    .replace(/^[・*▼■□●◆\s]+/, '')
    .replace(/[\[\]]/g, '')
    .trim();
}

function extractBudget(contextLines: readonly string[]): string | null {
  for (let i = contextLines.length - 1; i >= 0; i--) {
    const line = (contextLines[i] ?? '').trim();
    const match = line.match(BUDGET_PATTERN);
    if (match) {
      const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (value) return value;
    }
  }
  return null;
}
