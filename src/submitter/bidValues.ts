import type { Job } from '../types.js';
import type { Profile } from '../generator/profile.js';
import { parseMaxBudgetYen } from '../generator/scorer.js';

export interface BidValues {
  readonly amountYen: number;
  readonly deliveryDays: number;
  /** 算出根拠(監査ログ・Telegram表示用) */
  readonly rationale: string;
}

/**
 * 案件とプロファイルから提案フォームに入力する希望金額・納期を算出する(純関数)。
 * 金額 = 予算上限 × budgetRatio、ただし minAmountYen を下回らない。
 * 予算不明時は fallbackAmountYen。1000円単位に丸める。
 */
export function computeBidValues(job: Job, profile: Profile): BidValues {
  const { budgetRatio, fallbackAmountYen, deliveryDays, minAmountYen } = profile.bidding;
  const maxBudget = parseMaxBudgetYen(job.budgetText);

  let amountYen: number;
  let rationale: string;

  if (maxBudget === null) {
    amountYen = fallbackAmountYen;
    rationale = `予算不明のため既定額 ${fmt(fallbackAmountYen)}`;
  } else {
    const ratioAmount = roundTo1000(maxBudget * budgetRatio);
    amountYen = Math.max(ratioAmount, minAmountYen);
    rationale =
      amountYen === ratioAmount
        ? `予算上限 ${fmt(maxBudget)} × ${Math.round(budgetRatio * 100)}%`
        : `下限ガード ${fmt(minAmountYen)} を適用(算出値 ${fmt(ratioAmount)})`;
  }

  return { amountYen, deliveryDays, rationale };
}

function roundTo1000(value: number): number {
  return Math.round(value / 1000) * 1000;
}

function fmt(yen: number): string {
  return `${yen.toLocaleString()}円`;
}
