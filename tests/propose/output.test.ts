import { describe, expect, it } from 'vitest';
import type { JobAnalysis } from '../../src/generator/analysis.js';
import { proposalFileName, renderProposalMarkdown } from '../../src/propose/output.js';
import { buildJob } from '../../src/propose/input.js';

const job = buildJob({
  url: 'https://www.lancers.jp/work/detail/123',
  title: 'チャットボット開発',
  description: '社内FAQボットを作りたい',
  budgetText: '10万円',
  proposalCount: 3,
});

const score = { score: 72, reason: 'AI開発キーワード一致', matchedWorks: ['enterprise-rag'] } as const;

const analysis: JobAnalysis = {
  clientGoal: '問い合わせ対応の工数削減',
  painPoints: ['過去に外注で失敗(推測)'],
  idealCandidate: 'AI実装経験があり報連相が確実な人',
  mustAddress: ['類似実績の記載'],
  empathyHooks: ['FAQ運用の負担'],
  recommendedLength: 'medium',
  uncertainties: ['利用者数が不明'],
};

describe('renderProposalMarkdown', () => {
  it('提案文・スコア・分析・案件情報をすべて含む', () => {
    const md = renderProposalMarkdown({
      job,
      score,
      analysis,
      proposal: 'はじめまして。FAQボットの件、拝見しました。',
      issues: [],
      generatedAt: '2026-06-07 15:00:00',
    });
    expect(md).toContain('チャットボット開発');
    expect(md).toContain('はじめまして。FAQボットの件、拝見しました。');
    expect(md).toContain('72');
    expect(md).toContain('enterprise-rag');
    expect(md).toContain('問い合わせ対応の工数削減');
    expect(md).toContain('類似実績の記載');
    expect(md).toContain('社内FAQボットを作りたい');
    expect(md).toContain('https://www.lancers.jp/work/detail/123');
    expect(md).toContain('自己検査: OK');
  });

  it('分析がnullでも破綻しない', () => {
    const md = renderProposalMarkdown({
      job,
      score,
      analysis: null,
      proposal: '提案文本文',
      issues: [],
      generatedAt: '2026-06-07 15:00:00',
    });
    expect(md).toContain('分析なし');
    expect(md).toContain('提案文本文');
  });

  it('自己検査NGの場合は問題点を列挙する', () => {
    const md = renderProposalMarkdown({
      job,
      score,
      analysis,
      proposal: '短すぎる提案',
      issues: ['200字未満(現在7字)'],
      generatedAt: '2026-06-07 15:00:00',
    });
    expect(md).toContain('200字未満');
  });
});

describe('proposalFileName', () => {
  it('タイムスタンプ+タイトルスラグの.mdファイル名を返す', () => {
    const name = proposalFileName('チャットボット開発', new Date(2026, 5, 7, 15, 4, 5));
    expect(name).toBe('20260607-150405-チャットボット開発.md');
  });

  it('ファイル名に使えない文字を除去する', () => {
    const name = proposalFileName('【急募】AI/LLM開発 <月20万>', new Date(2026, 5, 7, 15, 4, 5));
    expect(name).not.toMatch(/[【】/<>:"\\|?*]/);
    expect(name).toMatch(/\.md$/);
  });

  it('長すぎるタイトルは切り詰める', () => {
    const name = proposalFileName('あ'.repeat(100), new Date(2026, 5, 7, 15, 4, 5));
    // 最大長 = タイムスタンプ15 + 区切り1 + スラグ30 + 拡張子3 = 49
    expect(name.length).toBeLessThanOrEqual(49);
  });

  it('ゼロ幅文字・双方向制御文字を除去する', () => {
    const name = proposalFileName('AI​開発‮案件', new Date(2026, 5, 7, 15, 4, 5));
    expect(name).toBe('20260607-150405-AI開発案件.md');
  });
});
