import type { Job, ScoreResult } from '../types.js';
import type { Profile, PortfolioWork } from './profile.js';
import type { Scorer } from './types.js';

/**
 * v1スコアラー: キーワード一致ベースの簡易判定。
 * 側(パイプライン)の検証用。後でLLM判定や受注実績フィードバックに差し替える。
 *
 * 配点: カテゴリ一致 50点 + スキル一致 30点 + 実績スタック一致 20点
 * NGキーワード含有は即0点。
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

    const score = Math.min(
      100,
      Math.min(categoryHits, 2) * 25 + // カテゴリ一致 最大50
        Math.min(skillHits, 3) * 10 + // スキル一致 最大30
        Math.min(matchedWorks.length, 2) * 10, // 実績一致 最大20
    );

    const reason = [
      `カテゴリ一致 ${categoryHits}件`,
      `スキル一致 ${skillHits}件`,
      `関連実績 ${matchedWorks.map((w) => w.name).join(', ') || 'なし'}`,
    ].join(' / ');

    return { score, reason, matchedWorks: matchedWorks.map((w) => w.name) };
  }
}

function countHits(text: string, keywords: readonly string[]): number {
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
}

function worksMatches(text: string, work: PortfolioWork): boolean {
  return work.stack.some((tech) => text.includes(tech.toLowerCase()));
}
