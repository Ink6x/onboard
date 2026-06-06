import type { Job, ScoreResult } from '../types.js';
import type { Profile, PortfolioWork } from './profile.js';
import type { Scorer } from './types.js';
import { findMatches, matchKeyword } from './textMatch.js';

/**
 * v2スコアラー: キーワード一致ベース+単語境界マッチ+職種ペナルティ。
 * 後でLLM判定や受注実績フィードバックに差し替える。
 *
 * 配点:
 *   カテゴリ一致 最大50点 + スキル一致 最大30点 + 実績スタック一致 最大20点
 *   + タイトル一致ボーナス 10点(タイトルは案件の種類を最も正確に表す)
 *   - 職種ペナルティ(タイトル -20/語, 説明文 -5/語。非開発職種の混入対策)
 * NGキーワード含有は即0点。予算上限が希望最低額未満なら30点に頭打ち。
 */

const CATEGORY_POINTS = 25; // カテゴリ一致1件あたり
const MAX_CATEGORY_HITS = 2;
const SKILL_POINTS = 10; // スキル一致1件あたり
const MAX_SKILL_HITS = 3;
const WORK_POINTS = 10; // 実績スタック一致1件あたり
const MAX_WORK_HITS = 2;
const TITLE_BONUS = 10; // カテゴリ/スキルがタイトルに一致した場合の加点
const TITLE_PENALTY = 20; // ペナルティ語がタイトルにある場合の減点(職種がほぼ確定)
const BODY_PENALTY = 5; // ペナルティ語が説明文にある場合の減点(言及程度の可能性)
const MAX_PENALTY_HITS = 2; // 減点対象として数える語数の上限(タイトル・説明文それぞれ)
const LOW_BUDGET_CAP = 30; // 予算上限が希望最低額未満の場合のスコア上限

export class KeywordScorer implements Scorer {
  score(job: Job, profile: Profile): ScoreResult {
    const title = job.title.toLowerCase();
    const body = `${job.description ?? ''} ${job.category ?? ''}`.toLowerCase();
    const fullText = `${title} ${body}`;

    const ngHit = profile.ngKeywords.find((ng) => matchKeyword(fullText, ng));
    if (ngHit) {
      return { score: 0, reason: `NGキーワード「${ngHit}」を含むため除外`, matchedWorks: [] };
    }

    const categoryHits = findMatches(fullText, profile.categories).length;
    const skillHits = findMatches(fullText, profile.skills).length;
    const matchedWorks = profile.works.filter((work) => worksMatches(fullText, work));

    const base =
      Math.min(categoryHits, MAX_CATEGORY_HITS) * CATEGORY_POINTS +
      Math.min(skillHits, MAX_SKILL_HITS) * SKILL_POINTS +
      Math.min(matchedWorks.length, MAX_WORK_HITS) * WORK_POINTS;

    // タイトルボーナス: 案件の種類を表すタイトルにカテゴリ/スキルが含まれるなら加点
    const titleHasSignal =
      findMatches(title, profile.categories).length > 0 ||
      findMatches(title, profile.skills).length > 0;
    const titleBonus = base > 0 && titleHasSignal ? TITLE_BONUS : 0;

    // 職種ペナルティ: タイトル一致は職種がほぼ確定するため重く、説明文は軽く減点
    const titlePenaltyWords = findMatches(title, profile.penaltyKeywords);
    const bodyPenaltyWords = findMatches(body, profile.penaltyKeywords).filter(
      (word) => !titlePenaltyWords.includes(word),
    );
    const penalty =
      Math.min(titlePenaltyWords.length, MAX_PENALTY_HITS) * TITLE_PENALTY +
      Math.min(bodyPenaltyWords.length, MAX_PENALTY_HITS) * BODY_PENALTY;

    let score = clamp(base + titleBonus - penalty, 0, 100);

    const reasons = [
      `カテゴリ一致 ${categoryHits}件`,
      `スキル一致 ${skillHits}件`,
      `関連実績 ${matchedWorks.map((w) => w.name).join(', ') || 'なし'}`,
    ];
    if (titleBonus > 0) reasons.push(`タイトル一致 +${titleBonus}`);
    if (penalty > 0) {
      const words = [...titlePenaltyWords, ...bodyPenaltyWords].join('、');
      reasons.push(`職種減点 -${penalty}(${words})`);
    }

    // 予算チェック: 上限が希望最低額に届かない案件は承認依頼まで上げない
    const maxBudget = parseMaxBudgetYen(job.budgetText);
    const minRequired = profile.conditions.minBudgetYen;
    if (maxBudget !== null && minRequired !== undefined && maxBudget < minRequired) {
      score = Math.min(score, LOW_BUDGET_CAP);
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function worksMatches(lowerText: string, work: PortfolioWork): boolean {
  return work.stack.some((tech) => matchKeyword(lowerText, tech));
}
