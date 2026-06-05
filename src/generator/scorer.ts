import type { Job, ScoreResult } from '../types.js';
import type { Profile, PortfolioWork } from './profile.js';
import type { Scorer } from './types.js';

/**
 * v1スコアラー: キーワード一致ベースの簡易判定。
 * 後でLLM判定や受注実績フィードバックに差し替える。
 *
 * 配点: カテゴリ一致 50点 + スキル一致 30点 + 実績スタック一致 20点
 * NGキーワード含有は即0点。予算上限が希望最低額未満なら30点に頭打ち。
 */
export class KeywordScorer implements Scorer {
  score(job: Job, profile: Profile): ScoreResult {
    const text = `${job.title} ${job.description ?? ''} ${job.category ?? ''}`.toLowerCase();

    const ngHit = profile.ngKeywords.find((ng) => text.includes(ng.toLowerCase()));
    if (ngHit) {
      return { score: 0, reason: `NGキーワード「${ngHit}」を含むため除外`, matchedWorks: [] };
    }

    const categoryHits = countHits(text, profile.categories);
    const skillHits = countHits(text, profile.skills);
    const matchedWorks = profile.works.filter((work) => worksMatches(text, work));

    let score = Math.min(
      100,
      Math.min(categoryHits, 2) * 25 + // カテゴリ一致 最大50
        Math.min(skillHits, 3) * 10 + // スキル一致 最大30
        Math.min(matchedWorks.length, 2) * 10, // 実績一致 最大20
    );

    const reasons = [
      `カテゴリ一致 ${categoryHits}件`,
      `スキル一致 ${skillHits}件`,
      `関連実績 ${matchedWorks.map((w) => w.name).join(', ') || 'なし'}`,
    ];

    // 予算チェック: 上限が希望最低額に届かない案件は承認依頼まで上げない
    const maxBudget = parseMaxBudgetYen(job.budgetText);
    const minRequired = profile.conditions.minBudgetYen;
    if (maxBudget !== null && minRequired !== undefined && maxBudget < minRequired) {
      score = Math.min(score, 30);
      reasons.push(`予算上限${maxBudget.toLocaleString()}円 < 希望最低${minRequired.toLocaleString()}円`);
    }

    return { score, reason: reasons.join(' / '), matchedWorks: matchedWorks.map((w) => w.name) };
  }
}

/** 「100,000円 ～ 200,000円」「50,000円」等から上限額を抽出する。 */
export function parseMaxBudgetYen(budgetText: string | null): number | null {
  if (!budgetText) return null;
  const amounts = [...budgetText.matchAll(/([\d,]+)\s*円/g)]
    .map((m) => Number((m[1] ?? '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return null;
  return Math.max(...amounts);
}

function countHits(text: string, keywords: readonly string[]): number {
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
}

function worksMatches(text: string, work: PortfolioWork): boolean {
  return work.stack.some((tech) => text.includes(tech.toLowerCase()));
}
