import { describe, expect, it } from 'vitest';
import { KeywordScorer, parseMaxBudgetYen } from '../src/generator/scorer.js';
import type { Job } from '../src/types.js';
import type { Profile } from '../src/generator/profile.js';

const profile: Profile = {
  displayName: 'Test',
  headline: 'AI開発者',
  intro: 'テスト用',
  works: [
    {
      name: 'Coaching AI Workflow',
      summary: 'AI業務自動化',
      outcomes: ['週150分→0分'],
      stack: ['RAG', 'Next.js', 'LINE'],
    },
  ],
  skills: ['ChatGPT', 'RAG', 'Next.js', 'TypeScript'],
  categories: ['AI開発', '業務自動化'],
  ngKeywords: ['アダルト'],
  conditions: {
    minBudgetYen: 50000,
    weeklyHours: '週20時間',
    responseSla: '24時間以内',
    firstDraftDays: '5営業日',
  },
  bidding: {
    budgetRatio: 0.9,
    fallbackAmountYen: 50000,
    deliveryDays: 30,
    minAmountYen: 30000,
  },
};

function makeJob(title: string, description = '', budgetText: string | null = null): Job {
  return {
    id: 1,
    source: 'dummy',
    emailId: null,
    url: 'https://www.lancers.jp/work/detail/1',
    title,
    description,
    budgetText,
    category: null,
    deadline: null,
    status: 'new',
    fitScore: null,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
    proposalCount: null,
    bidAmountYen: null,
    bidDeliveryDays: null,
    submitError: null,
    screenshotPath: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('KeywordScorer', () => {
  const scorer = new KeywordScorer();

  it('カテゴリ・スキル・実績が一致する案件に高スコアを付ける', () => {
    const result = scorer.score(
      makeJob('【AI開発】ChatGPTとRAGを使った業務自動化', 'Next.jsでの管理画面も'),
      profile,
    );
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.matchedWorks).toContain('Coaching AI Workflow');
  });

  it('無関係な案件に低スコアを付ける', () => {
    const result = scorer.score(makeJob('チラシのデザイン制作'), profile);
    expect(result.score).toBeLessThan(30);
  });

  it('NGキーワードを含む案件は0点にする', () => {
    const result = scorer.score(makeJob('アダルトサイトの開発'), profile);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('NGキーワード');
  });

  it('予算上限が希望最低額未満なら30点に頭打ちする', () => {
    const result = scorer.score(
      makeJob('【AI開発】ChatGPTとRAGを使った業務自動化', 'Next.jsも', '10,000円 ～ 30,000円'),
      profile,
    );
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.reason).toContain('予算上限');
  });

  it('予算が希望最低額以上なら頭打ちしない', () => {
    const result = scorer.score(
      makeJob('【AI開発】ChatGPTとRAGを使った業務自動化', 'Next.jsも', '100,000円 ～ 200,000円'),
      profile,
    );
    expect(result.score).toBeGreaterThanOrEqual(60);
  });
});

describe('parseMaxBudgetYen', () => {
  it('レンジ表記から上限額を取り出す', () => {
    expect(parseMaxBudgetYen('100,000円 ～ 200,000円')).toBe(200000);
  });
  it('単一金額にも対応する', () => {
    expect(parseMaxBudgetYen('50,000円')).toBe(50000);
  });
  it('金額が無ければnull', () => {
    expect(parseMaxBudgetYen('応相談')).toBeNull();
    expect(parseMaxBudgetYen(null)).toBeNull();
  });
});
