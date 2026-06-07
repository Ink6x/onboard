import { describe, expect, it } from 'vitest';
import {
  extractBlockquote,
  extractBulletItems,
  extractYamlBlock,
  findSection,
  lookupTableValue,
  parseSections,
  splitFrontmatter,
} from '../../src/sync/markdown.js';

describe('splitFrontmatter', () => {
  it('frontmatterと本文を分離できる', () => {
    const result = splitFrontmatter('---\nslug: test\nname: テスト\n---\n\n## 概要\n\n本文');
    expect(result?.frontmatter).toEqual({ slug: 'test', name: 'テスト' });
    expect(result?.body).toContain('## 概要');
  });

  it('CRLF改行でも分離できる', () => {
    const result = splitFrontmatter('---\r\nslug: test\r\n---\r\n本文');
    expect(result?.frontmatter).toEqual({ slug: 'test' });
  });

  it('frontmatterが無ければnullを返す', () => {
    expect(splitFrontmatter('# ただのMarkdown')).toBeNull();
  });
});

describe('parseSections / findSection', () => {
  const body = '前置き\n\n## 概要（1段落）\n\n概要本文です。\n\n## 課題背景\n\n背景本文。\n';

  it('## 見出し単位で分割できる', () => {
    const sections = parseSections(body);
    expect(sections.get('課題背景')).toBe('背景本文。');
  });

  it('付記つき見出しを前方一致で引ける', () => {
    const sections = parseSections(body);
    expect(findSection(sections, '概要')).toBe('概要本文です。');
  });

  it('見つからない見出しはnull', () => {
    expect(findSection(parseSections(body), '存在しない')).toBeNull();
  });
});

describe('extractYamlBlock', () => {
  it('指定キーを含むyamlブロックをパースして返す', () => {
    const md = '説明\n\n```yaml\nlancers_works:\n  - a\n  - b\n```\n';
    expect(extractYamlBlock(md, 'lancers_works')).toEqual({ lancers_works: ['a', 'b'] });
  });

  it('複数ブロックがあってもキーで正しい方を選ぶ', () => {
    const md = '```yaml\nother: 1\n```\n\n```yaml\nforbidden_terms:\n  - 秘密\n```';
    expect(extractYamlBlock(md, 'forbidden_terms')).toEqual({ forbidden_terms: ['秘密'] });
  });

  it('該当ブロックが無ければnull(fail-closed用)', () => {
    expect(extractYamlBlock('```yaml\nother: 1\n```', 'forbidden_terms')).toBeNull();
  });

  it('パース不能なyamlブロックがあればthrowする(壊れた設定の隠蔽を防ぐ)', () => {
    const md = '```yaml\nkey: [壊れた\n```\n\n```yaml\nforbidden_terms:\n  - a\n```';
    expect(() => extractYamlBlock(md, 'forbidden_terms')).toThrow(/パースできません/);
  });
});

describe('lookupTableValue', () => {
  const md = '| 項目 | 値 | 公開層 |\n|---|---|---|\n| 公開名 | Ink6x（GitHub等） / Jullien | `public` |\n';

  it('ラベル一致行の指定列を返す', () => {
    expect(lookupTableValue(md, '公開名', 1)).toBe('Ink6x（GitHub等） / Jullien');
  });

  it('見つからなければnull', () => {
    expect(lookupTableValue(md, '存在しない', 1)).toBeNull();
  });
});

describe('extractBlockquote', () => {
  it('blockquote行を連結して返す', () => {
    expect(extractBlockquote('> 一行目\n> 二行目\n\n注記')).toBe('一行目\n二行目');
  });

  it('blockquoteが無ければnull', () => {
    expect(extractBlockquote('ただの文')).toBeNull();
  });
});

describe('extractBulletItems', () => {
  it('「」内の要素文を抽出し、付記を落とす', () => {
    const items = extractBulletItems('- 「要素文A」（最重要）\n- 「要素文B」\n- 裸の要素文C\n');
    expect(items).toEqual(['要素文A', '要素文B', '裸の要素文C']);
  });
});
