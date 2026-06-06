import { describe, expect, it } from 'vitest';
import { computeBidValues } from '../src/submitter/bidValues.js';
import type { Job } from '../src/types.js';
import type { Profile } from '../src/generator/profile.js';

const profile = {
  bidding: { budgetRatio: 0.9, fallbackAmountYen: 50000, deliveryDays: 30, minAmountYen: 30000 },
} as Profile;

function jobWithBudget(budgetText: string | null): Job {
  return { budgetText } as Job;
}

describe('computeBidValues', () => {
  it('予算上限の90%を1000円単位で提示する', () => {
    const bid = computeBidValues(jobWithBudget('100,000円 ～ 200,000円'), profile);
    expect(bid.amountYen).toBe(180000); // 200,000 * 0.9
    expect(bid.deliveryDays).toBe(30);
    expect(bid.rationale).toContain('90%');
  });

  it('算出値が下限を割る場合は下限ガードを適用する', () => {
    const bid = computeBidValues(jobWithBudget('20,000円 ～ 30,000円'), profile);
    expect(bid.amountYen).toBe(30000); // 27,000 < 30,000(下限)
    expect(bid.rationale).toContain('下限ガード');
  });

  it('予算不明時は既定額を使う', () => {
    const bid = computeBidValues(jobWithBudget(null), profile);
    expect(bid.amountYen).toBe(50000);
    expect(bid.rationale).toContain('予算不明');
  });
});
