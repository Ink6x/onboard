import type { JobCandidate } from '../types.js';

/**
 * Lancers「【新着】〜カテゴリに、新しい仕事が登録されました!」メールのパーサー。
 *
 * 実メール(2026-06)で確認したフォーマット:
 * ```
 * ━━━━━━━━
 * ■■　Webシステム開発・プログラミング　■■ （2件）
 * ━━━━━━━━
 * ----------------
 * ▼ 案件タイトル
 * [依頼金額] 100,000円 ～ 200,000円
 * [方式] プロジェクト
 * [募集締切] 2026年6月6日 18:14
 * https://www.lancers.jp/work/monitor/5545030/new_work_mail/
 * ```
 * URLはトラッキング用で、案件IDから正規の詳細URL(/work/detail/<id>)へ変換する。
 * 構造化パースで何も取れない場合は、汎用のURL走査にフォールバックする
 * (「仕事の招待状」など別形式のメールへの保険)。
 */

const WORK_URL_PATTERN = /https?:\/\/(?:www\.)?lancers\.jp\/work\/(?:monitor|detail)\/(\d+)\S*/;
const CATEGORY_PATTERN = /^■■\s*(.+?)\s*■■/;
const TITLE_PATTERN = /^▼\s*(.+)$/;
const BUDGET_PATTERN = /^\[依頼金額\]\s*(.+)$/;
const DEADLINE_PATTERN = /^\[募集締切\]\s*(.+)$/;

/** 案件IDから正規の詳細ページURL(冪等性キー)を生成する。 */
export function canonicalWorkUrl(workId: string): string {
  return `https://www.lancers.jp/work/detail/${workId}`;
}

export function parseLancersEmail(plainTextBody: string): readonly JobCandidate[] {
  const structured = parseStructured(plainTextBody);
  if (structured.length > 0) return structured;
  return parseGenericFallback(plainTextBody);
}

/** 新着仕事メールのセクション構造を前提とした本パーサー。 */
function parseStructured(body: string): readonly JobCandidate[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const candidates: JobCandidate[] = [];
  const seenIds = new Set<string>();

  let currentCategory: string | undefined;
  let currentTitle: string | undefined;
  let currentBudget: string | undefined;
  let currentDeadline: string | undefined;

  for (const line of lines) {
    const categoryMatch = line.match(CATEGORY_PATTERN);
    if (categoryMatch) {
      currentCategory = categoryMatch[1];
      continue;
    }

    const titleMatch = line.match(TITLE_PATTERN);
    if (titleMatch) {
      currentTitle = titleMatch[1]?.trim();
      currentBudget = undefined;
      currentDeadline = undefined;
      continue;
    }

    const budgetMatch = line.match(BUDGET_PATTERN);
    if (budgetMatch) {
      currentBudget = budgetMatch[1]?.trim();
      continue;
    }

    const deadlineMatch = line.match(DEADLINE_PATTERN);
    if (deadlineMatch) {
      currentDeadline = deadlineMatch[1]?.trim();
      continue;
    }

    const urlMatch = line.match(WORK_URL_PATTERN);
    if (urlMatch && currentTitle) {
      const workId = urlMatch[1];
      if (workId && !seenIds.has(workId)) {
        seenIds.add(workId);
        candidates.push({
          url: canonicalWorkUrl(workId),
          title: currentTitle,
          ...(currentBudget ? { budgetText: currentBudget } : {}),
          ...(currentDeadline ? { deadline: currentDeadline } : {}),
          ...(currentCategory ? { category: currentCategory } : {}),
        });
      }
      currentTitle = undefined; // 1案件 = 1URL。次の▼まで取り込まない
    }
  }

  return candidates;
}

/** 別形式メール用の汎用フォールバック: 案件URLとその直前の非空行をタイトルとして拾う。 */
function parseGenericFallback(body: string): readonly JobCandidate[] {
  const lines = body.split(/\r?\n/);
  const candidates: JobCandidate[] = [];
  const seenIds = new Set<string>();

  lines.forEach((line, index) => {
    const match = line.match(WORK_URL_PATTERN);
    if (!match) return;
    const workId = match[1];
    if (!workId || seenIds.has(workId)) return;
    seenIds.add(workId);

    const title = findNearestTitle(lines, index) ?? `Lancers案件 ${workId}`;
    candidates.push({ url: canonicalWorkUrl(workId), title });
  });

  return candidates;
}

function findNearestTitle(lines: readonly string[], urlIndex: number): string | null {
  for (let i = urlIndex - 1; i >= Math.max(0, urlIndex - 4); i--) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    if (/^https?:\/\//.test(line)) continue;
    if (/^[-=_*■□▼▽─━…]+$/.test(line)) continue;
    return line.replace(/^[・*▼■□●◆\s]+/, '').trim();
  }
  return null;
}
