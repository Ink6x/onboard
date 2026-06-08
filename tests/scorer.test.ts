import { describe, expect, it } from 'vitest';
import { KeywordScorer, parseMaxBudgetYen } from '../src/generator/scorer.js';
import type { Job } from '../src/types.js';
import type { Profile } from '../src/generator/profile.js';

const profile: Profile = {
  displayName: 'Test',
  headline: 'AI開発者',
  intro: 'テスト用',
  careerSummary: '',
  strengths: [],
  works: [
    {
      name: 'Coaching AI Workflow',
      summary: 'AI業務自動化',
      outcomes: ['週150分→0分'],
      stack: ['RAG', 'Next.js', 'LINE'],
    },
  ],
  skills: ['AI', 'ChatGPT', 'RAG', 'Next.js', 'TypeScript', 'LINE', '自動化'],
  categories: ['AI開発', '業務自動化'],
  ngKeywords: ['アダルト', '成人向け'],
  penaltyKeywords: ['経理', '総務', '動画編集', 'モデル募集', 'データ入力'],
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

describe('KeywordScorer v2: 英数字キーワードの単語境界マッチ', () => {
  const scorer = new KeywordScorer();

  it('英単語内の部分一致を誤検知しない(detail の ai 等)', () => {
    // DB実データで頻発した誤検知: 説明文中の英単語に「AI」「LINE」が部分一致していた
    const result = scorer.score(
      makeJob('ポスターのデザイン制作', 'Please see the detail. Online meeting available.'),
      profile,
    );
    expect(result.score).toBe(0);
    expect(result.reason).toContain('スキル一致 0件');
  });

  it('日本語文中の単独キーワードは正しく一致する(AIツール等)', () => {
    const result = scorer.score(makeJob('AIを活用した業務自動化ツールの開発'), profile);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).not.toContain('スキル一致 0件');
  });

  it('記号を含むキーワード(Next.js)を正しく一致させる', () => {
    const result = scorer.score(makeJob('Webアプリ開発', 'Next.jsでのフロント実装'), profile);
    expect(result.reason).not.toContain('スキル一致 0件');
  });
});

describe('KeywordScorer v2: ペナルティキーワード', () => {
  const scorer = new KeywordScorer();

  it('タイトルに非開発職種(経理等)を含む案件を大幅減点する', () => {
    // DB実データ #200: 経理募集なのに説明文の「業務自動化」一語で通知された
    const result = scorer.score(
      makeJob('月30万～【経理】急成長企業を支える経理募集', '業務自動化に積極的な会社です'),
      profile,
    );
    expect(result.score).toBeLessThan(20);
    expect(result.reason).toContain('減点');
  });

  it('タイトルにAIがあっても職種が動画編集なら減点する', () => {
    const result = scorer.score(makeJob('【動画編集】AIアニメーション物語の編集パートナー募集'), profile);
    expect(result.score).toBeLessThan(20);
  });

  it('強い開発シグナルがあればペナルティ語が説明文にあっても生き残る', () => {
    // 「AIを使った動画生成」系の開発案件は実績作りの対象(ユーザー要件)
    const result = scorer.score(
      makeJob(
        '【AI開発】ChatGPTとRAGを使った業務自動化システムの構築',
        '動画編集ソフトとの連携も検討。Next.js管理画面あり',
        '200,000円',
      ),
      profile,
    );
    expect(result.score).toBeGreaterThanOrEqual(60);
  });
});

describe('KeywordScorer v2: タイトル重み付け', () => {
  const scorer = new KeywordScorer();

  it('同じ一致内容ならタイトル一致の方が高スコアになる', () => {
    const inTitle = scorer.score(makeJob('ChatGPTを使ったRAGの構築', ''), profile);
    const inDescOnly = scorer.score(makeJob('システムの構築', 'ChatGPTを使ったRAGの構築'), profile);
    expect(inTitle.score).toBeGreaterThan(inDescOnly.score);
  });
});

describe('KeywordScorer v2: NGキーワード追加分', () => {
  const scorer = new KeywordScorer();

  it('成人向け案件を0点にする', () => {
    // DB実データ #53, #78: 成人向け案件がスコア10で通知されていた
    const result = scorer.score(makeJob('成人向け音声作品のシナリオ制作の依頼'), profile);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('NGキーワード');
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
