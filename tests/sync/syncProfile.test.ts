import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { profileSchema } from '../../src/generator/profile.js';
import type { KbSnapshot, KbWork } from '../../src/sync/kbSchema.js';
import type { SalesConfig } from '../../src/sync/salesConfig.js';
import { pickWorkUrl, syncProfileFromKb } from '../../src/sync/syncProfile.js';
import { KbTransformer, type MessageCreator } from '../../src/sync/transformer.js';

function makeWork(slug: string, disclosure: KbWork['disclosure'], links: Record<string, string> = {}): KbWork {
  return {
    slug,
    name: `実績 ${slug}`,
    disclosure,
    stack: ['TypeScript'],
    links,
    sections: new Map([['概要', `${slug} の概要`]]),
    relativePath: `works/${slug}.md`,
  };
}

function makeKb(overrides: Partial<KbSnapshot> = {}): KbSnapshot {
  return {
    works: [
      makeWork('work-a', 'anonymized', { repo: 'https://github.com/x/a' }),
      makeWork('work-secret', 'private'),
    ],
    lancersAllowlist: ['work-a', 'work-secret'],
    forbiddenTerms: ['架空商事', 'ダミー名前', 'CTO', 'examplecorp', 'secret-service'],
    displayName: 'Ink6x',
    headline: '肩書き',
    intro: '自己紹介。',
    strengths: ['要素A'],
    careerMd: '# 経歴全文',
    outcomesMd: '# 正規値',
    fileContents: { 'DISCLOSURE.md': 'x', 'works/work-a.md': 'y' },
    ...overrides,
  };
}

const sales: SalesConfig = {
  skills: ['AI'],
  categories: ['AI開発'],
  ngKeywords: [],
  penaltyKeywords: [],
  conditions: { weeklyHours: '週20時間', responseSla: '24時間以内', firstDraftDays: '5営業日以内' },
  bidding: { budgetRatio: 0.9, fallbackAmountYen: 5000, deliveryDays: 30, minAmountYen: 1000 },
};

/** 常に固定のJSON/テキストを返すLLMスタブ。 */
function stubTransformer(
  workName = '匿名実績',
  career = '2022年から約3年半、AI開発とWebアプリ開発の実務に携わってきました。規模も業種も異なる複数の現場を経験し、要件定義から本番運用まで一人で完結できます。',
): KbTransformer {
  const creator: MessageCreator = {
    create: async (params) => {
      const isWork = params.system.includes('実績素材');
      const text = isWork
        ? JSON.stringify({ name: workName, summary: '概要', experienceNote: '語り', outcomes: ['成果'] })
        : career;
      return { content: [{ type: 'text', text }] };
    },
  };
  return new KbTransformer(creator);
}

describe('syncProfileFromKb', () => {
  it('全ステージを通過し、loadProfile互換のYAMLと鮮度記録を返す', async () => {
    const result = await syncProfileFromKb(makeKb(), sales, stubTransformer(), '2026-06-07T00:00:00Z');
    expect(result.profile.works).toHaveLength(1); // private除外後
    expect(result.profile.works[0]?.url).toBe('https://github.com/x/a');
    expect(result.profile.works[0]?.stack).toEqual(['TypeScript']);
    expect(result.warnings.some((w) => w.includes('work-secret'))).toBe(true);
    expect(profileSchema.safeParse(parse(result.yamlText)).success).toBe(true);
    expect(Object.keys(result.record.files)).toContain('DISCLOSURE.md');
    expect(result.record.generatedAt).toBe('2026-06-07T00:00:00Z');
  });

  it('LLM出力に禁止語が混入したら同期を中止する(最終防壁)', async () => {
    const leaky = stubTransformer('架空商事向けの実績'); // 社名リーク
    await expect(syncProfileFromKb(makeKb(), sales, leaky, '2026-06-07T00:00:00Z')).rejects.toThrow(/禁止語/);
  });

  it('careerSummaryへのリークも検出する', async () => {
    const leaky = stubTransformer(
      '匿名実績',
      '架空商事のCTOとして2022年から約3年半、AI開発とWebアプリ開発の実務に携わってきました。規模の異なる複数の現場を経験してきました。',
    );
    await expect(syncProfileFromKb(makeKb(), sales, leaky, '2026-06-07T00:00:00Z')).rejects.toThrow(/禁止語/);
  });

  it('禁止語リストが下限未満ならLLM呼び出し前に中止する(fail-closed)', async () => {
    const kb = makeKb({ forbiddenTerms: ['1語だけ'] });
    let called = false;
    const creator: MessageCreator = {
      create: async () => {
        called = true;
        return { content: [{ type: 'text', text: '{}' }] };
      },
    };
    await expect(syncProfileFromKb(kb, sales, new KbTransformer(creator), '2026-06-07T00:00:00Z')).rejects.toThrow(
      /fail-closed/,
    );
    expect(called).toBe(false);
  });

  it('LLM変換の失敗はどの実績かを明示する', async () => {
    const creator: MessageCreator = {
      create: async (params) => ({
        content: [{ type: 'text', text: params.system.includes('実績素材') ? '不正な応答' : 'a'.repeat(60) }],
      }),
    };
    await expect(
      syncProfileFromKb(makeKb(), sales, new KbTransformer(creator), '2026-06-07T00:00:00Z'),
    ).rejects.toThrow(/work-a/);
  });
});

describe('pickWorkUrl', () => {
  it('repo > demo > detail の優先順で選ぶ', () => {
    expect(pickWorkUrl({ demo: 'https://demo.example', repo: 'https://repo.example' })).toBe('https://repo.example');
    expect(pickWorkUrl({ detail: 'https://detail.example', demo: 'https://demo.example' })).toBe('https://demo.example');
  });

  it('URL以外の付記(Coming Soon等)を落とす', () => {
    expect(pickWorkUrl({ detail: 'https://example.com/work/x（Coming Soon）' })).toBe('https://example.com/work/x');
  });

  it('URLが無ければundefined', () => {
    expect(pickWorkUrl({})).toBeUndefined();
    expect(pickWorkUrl({ repo: 'リポジトリなし' })).toBeUndefined();
  });
});
