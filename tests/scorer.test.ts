import { describe, expect, it } from 'vitest';
import { KeywordScorer } from '../src/generator/scorer.js';
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
    weeklyHours: '週20時間',
    responseSla: '24時間以内',
    firstDraftDays: '5営業日',
  },
};

function makeJob(title: string, description = ''): Job {
  return {
    id: 1,
    source: 'dummy',
    emailId: null,
    url: 'https://www.lancers.jp/work/detail/1',
    title,
    description,
    budgetText: null,
    category: null,
    deadline: null,
    status: 'new',
    fitScore: null,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
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
});
