import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { composeProfile, renderProfileYaml, type GeneratedKbPart } from '../../src/sync/compose.js';
import { profileSchema } from '../../src/generator/profile.js';
import type { SalesConfig } from '../../src/sync/salesConfig.js';

const generated: GeneratedKbPart = {
  displayName: 'Ink6x',
  headline: 'AIワークフロー自動化',
  intro: '自己紹介文。',
  careerSummary: '約3年半の実務経験。',
  strengths: ['要素A', '要素B'],
  works: [
    {
      name: '実績1',
      summary: '概要1',
      experienceNote: '経験の語り1',
      outcomes: ['成果1'],
      stack: ['TypeScript'],
      url: 'https://example.com/work1',
    },
    {
      name: '実績2(URLなし)',
      summary: '概要2',
      experienceNote: '経験の語り2',
      outcomes: [],
      stack: ['Python'],
    },
  ],
};

const sales: SalesConfig = {
  skills: ['AI', 'TypeScript'],
  categories: ['AI開発'],
  ngKeywords: ['アダルト'],
  penaltyKeywords: ['経理'],
  conditions: { minBudgetYen: 1000, weeklyHours: '週20時間', responseSla: '24時間以内', firstDraftDays: '5営業日以内' },
  bidding: { budgetRatio: 0.9, fallbackAmountYen: 5000, deliveryDays: 30, minAmountYen: 1000 },
};

describe('composeProfile', () => {
  it('KB由来とsales.yamlを合成してprofileSchemaを通る形を返す', () => {
    const profile = composeProfile(generated, sales);
    expect(profile.displayName).toBe('Ink6x');
    expect(profile.works).toHaveLength(2);
    expect(profile.skills).toEqual(['AI', 'TypeScript']);
    expect(profile.conditions.minBudgetYen).toBe(1000);
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it('urlが無い実績はurlキー自体を持たない', () => {
    const profile = composeProfile(generated, sales);
    expect('url' in (profile.works[1] ?? {})).toBe(false);
  });

  it('入力オブジェクトを変更しない(イミュータブル)', () => {
    const salesCopy = structuredClone(sales);
    const generatedCopy = structuredClone(generated) as GeneratedKbPart;
    composeProfile(generatedCopy, salesCopy);
    expect(salesCopy).toEqual(sales);
    expect(generatedCopy).toEqual(generated);
  });

  it('不正な合成結果はthrowする', () => {
    const broken = { ...generated, displayName: 123 as unknown as string };
    expect(() => composeProfile(broken, sales)).toThrow(/スキーマ検証/);
  });
});

describe('renderProfileYaml', () => {
  it('自動生成ヘッダつきで、loadProfile互換のYAMLを出力する', () => {
    const profile = composeProfile(generated, sales);
    const yamlText = renderProfileYaml(profile, '2026-06-07T00:00:00Z');
    expect(yamlText).toContain('# このファイルは自動生成されます');
    expect(yamlText).toContain('2026-06-07T00:00:00Z');
    // 出力をパースし直してもスキーマを通る(ラウンドトリップ)
    expect(profileSchema.safeParse(parse(yamlText)).success).toBe(true);
  });
});
