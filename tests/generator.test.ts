import { describe, expect, it } from 'vitest';
import { validateProposal } from '../src/generator/claudeGenerator.js';
import { parseJobAnalysis } from '../src/generator/analysis.js';
import type { Job } from '../src/types.js';

function makeJob(title: string): Job {
  return { title } as Job;
}

describe('validateProposal (v2: 上限なし)', () => {
  const job = makeJob('AIチャットボット開発のご依頼');

  it('下限を満たしタイトルに言及していればOK', () => {
    const proposal = `AIチャットボット開発の件、拝見しました。${'あ'.repeat(300)}`;
    expect(validateProposal(proposal, job)).toEqual([]);
  });

  it('長文でも上限エラーを出さない(上限撤廃)', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(1500)}`;
    expect(validateProposal(proposal, job)).toEqual([]);
  });

  it('短すぎる出力は下限NGになる', () => {
    const proposal = 'AIチャットボット作れます。';
    const issues = validateProposal(proposal, job);
    expect(issues.some((i) => i.includes('字未満'))).toBe(true);
  });

  it('タイトルキーワードへの言及がないとNGになる', () => {
    const proposal = `はじめまして。${'う'.repeat(300)}`;
    const issues = validateProposal(proposal, job);
    expect(issues.some((i) => i.includes('タイトル'))).toBe(true);
  });
});

describe('parseJobAnalysis', () => {
  const valid = {
    clientGoal: '問い合わせ対応の自動化',
    painPoints: ['夜間の問い合わせに対応できない'],
    idealCandidate: '実務でチャットボットを運用まで持っていった経験者',
    mustAddress: ['類似実績の記載'],
    empathyHooks: ['少人数で回している'],
    recommendedLength: 'medium',
    uncertainties: ['利用想定件数が不明'],
  };

  it('素のJSONをパースできる', () => {
    const result = parseJobAnalysis(JSON.stringify(valid));
    expect(result?.clientGoal).toBe('問い合わせ対応の自動化');
    expect(result?.recommendedLength).toBe('medium');
  });

  it('コードフェンスや前置きが混ざってもパースできる', () => {
    const text = `分析結果は以下です。\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``;
    const result = parseJobAnalysis(text);
    expect(result?.idealCandidate).toContain('チャットボット');
  });

  it('省略可能フィールドはデフォルトで補完される', () => {
    const result = parseJobAnalysis(
      JSON.stringify({ clientGoal: 'x', idealCandidate: 'y' }),
    );
    expect(result?.painPoints).toEqual([]);
    expect(result?.recommendedLength).toBe('medium');
  });

  it('JSONでない出力はnullを返す(生成は止めない)', () => {
    expect(parseJobAnalysis('すみません、分析できませんでした。')).toBeNull();
  });

  it('スキーマ違反(recommendedLengthが不正)はnullを返す', () => {
    expect(
      parseJobAnalysis(
        JSON.stringify({ clientGoal: 'x', idealCandidate: 'y', recommendedLength: 'huge' }),
      ),
    ).toBeNull();
  });
});
