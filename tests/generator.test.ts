import { describe, expect, it } from 'vitest';
import { validateProposal } from '../src/generator/claudeGenerator.js';
import { parseJobAnalysis } from '../src/generator/analysis.js';
import type { Job } from '../src/types.js';

function makeJob(title: string): Job {
  return { title } as Job;
}

describe('validateProposal (v3: 適正分量レンジの上限を強制)', () => {
  const job = makeJob('AIチャットボット開発のご依頼');

  it('下限を満たしタイトルに言及していればOK', () => {
    const proposal = `AIチャットボット開発の件、拝見しました。${'あ'.repeat(300)}`;
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

  it('shortレンジ(上限600字)を大きく超えるとNGになる', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(900)}`;
    const issues = validateProposal(proposal, job, 'short');
    expect(issues.some((i) => i.includes('上限600字'))).toBe(true);
  });

  it('mediumレンジで上限1000字+許容1割以内ならOK', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(1050)}`;
    expect(validateProposal(proposal, job, 'medium')).toEqual([]);
  });

  it('mediumレンジで上限1000字を1割超えて超過するとNGになる', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(1200)}`;
    const issues = validateProposal(proposal, job, 'medium');
    expect(issues.some((i) => i.includes('上限1000字'))).toBe(true);
  });

  it('分析なしの場合はlong上限(1600字)を適用し、2000字近い出力はNGになる', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(1950)}`;
    const issues = validateProposal(proposal, job);
    expect(issues.some((i) => i.includes('上限1600字'))).toBe(true);
  });

  it('longレンジで1600字以内ならOK', () => {
    const proposal = `AIチャットボットの構築について。${'い'.repeat(1500)}`;
    expect(validateProposal(proposal, job, 'long')).toEqual([]);
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
