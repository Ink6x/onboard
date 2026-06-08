import { describe, expect, it } from 'vitest';
import {
  extractForbiddenTerms,
  extractHeadline,
  extractIntroText,
  extractLancersAllowlist,
  extractLancersDisplayName,
  extractStrengths,
  parseWorkFile,
} from '../../src/sync/kbReader.js';

const WORK_MD = `---
slug: sample-work
name: サンプル実績
type: 受託
period: 2025/01〜2025/06
status: 終了
disclosure: anonymized
client: 架空クライアント（公開物には転記禁止）
role: [Fullstack]
stack: [TypeScript, Next.js, PostgreSQL (Supabase)]
links:
  repo: https://github.com/example/sample
sources:
  - profile/career.md
---

## 概要

サンプルの概要文。

## 課題背景

サンプルの背景。

## 成果（定量）

サンプルの成果。
`;

describe('parseWorkFile', () => {
  it('frontmatterと本文セクションを構造化する', () => {
    const work = parseWorkFile(WORK_MD, 'works/sample-work.md');
    expect(work.slug).toBe('sample-work');
    expect(work.disclosure).toBe('anonymized');
    expect(work.stack).toEqual(['TypeScript', 'Next.js', 'PostgreSQL (Supabase)']);
    expect(work.links.repo).toBe('https://github.com/example/sample');
    expect(work.sections.get('概要')).toBe('サンプルの概要文。');
  });

  it('client/periodはprivate情報を含むため構造化結果に持ち込まない', () => {
    const work = parseWorkFile(WORK_MD, 'works/sample-work.md');
    expect(JSON.stringify({ ...work, sections: undefined })).not.toContain('架空クライアント');
    expect(JSON.stringify({ ...work, sections: undefined })).not.toContain('2025/01');
  });

  it('付記つきdisclosureを正規化する', () => {
    const md = WORK_MD.replace('disclosure: anonymized', 'disclosure: private（公開枠のみpublic）');
    expect(parseWorkFile(md, 'works/x.md').disclosure).toBe('private');
  });

  it('不正なdisclosureはファイル名つきでthrowする', () => {
    const md = WORK_MD.replace('disclosure: anonymized', 'disclosure: 公開OK');
    expect(() => parseWorkFile(md, 'works/x.md')).toThrow(/works\/x\.md/);
  });

  it('frontmatterが無いとthrowする', () => {
    expect(() => parseWorkFile('# 本文だけ', 'works/y.md')).toThrow(/frontmatter/);
  });
});

describe('Lancersチャネル設定 / extractForbiddenTerms (fail-closed)', () => {
  const CHANNELS_MD = '前文\n```yaml\nlancers_display_name: じゅり # 表示名\nlancers_works:\n  - work-a # コメント\n  - work-b\n```';

  it('yamlブロックから掲載リストを抽出する', () => {
    expect(extractLancersAllowlist(CHANNELS_MD)).toEqual(['work-a', 'work-b']);
  });

  it('yamlブロックからLancers表示名を抽出する', () => {
    expect(extractLancersDisplayName(CHANNELS_MD)).toBe('じゅり');
  });

  it('ブロックが無ければthrowする', () => {
    expect(() => extractLancersAllowlist('リスト無し')).toThrow(/lancers_works/);
    expect(() => extractForbiddenTerms('リスト無し')).toThrow(/fail-closed/);
  });

  it('表示名が無ければthrowする(黙ってデフォルトにしない)', () => {
    const md = '```yaml\nlancers_works:\n  - work-a\n```';
    expect(() => extractLancersDisplayName(md)).toThrow(/lancers_display_name/);
    expect(() => extractLancersAllowlist(md)).toThrow(/lancers_display_name/);
  });

  it('禁止語ブロックを抽出する', () => {
    const md = '```yaml\nforbidden_terms:\n  - 架空商事 # 社名\n  - ダミー名\n```';
    expect(extractForbiddenTerms(md)).toEqual(['架空商事', 'ダミー名']);
  });
});

describe('プロフィール系の抽出', () => {
  it('肩書きテーブルからheadlineを抽出する', () => {
    const md = '| 用途 | 表記 | 公開層 |\n|---|---|---|\n| 公開（日本語） | AIワークフロー自動化 / フルスタック開発 | public |';
    expect(extractHeadline(md)).toBe('AIワークフロー自動化 / フルスタック開発');
  });

  it('ショート版自己PRをblockquoteから抽出する', () => {
    const md = '## ショート版（公開プロフィール用）\n\n> 一文目。\n> 二文目。\n';
    expect(extractIntroText(md)).toBe('一文目。二文目。');
  });

  it('スタンス要素文を抽出する(「」と付記を除去)', () => {
    const md = '## スタンス・設計思想の言語化\n\n- 「要素A」（最重要）\n- 「要素B」\n';
    expect(extractStrengths(md)).toEqual(['要素A', '要素B']);
  });

  it('抽出できない場合はthrowする(黙ってデフォルトにしない)', () => {
    expect(() => extractHeadline('テーブル無し')).toThrow(/公開（日本語）/);
    expect(() => extractIntroText('## 別の見出し\n本文')).toThrow(/ショート版/);
    expect(() => extractStrengths('## 別の見出し\n本文')).toThrow(/スタンス/);
  });
});
