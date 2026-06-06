import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSearchResults } from '../src/collector/searchParser.js';

/**
 * 実検索ページ(2026-06-06取得)のHTMLフィクスチャ。
 * - search-keyword-ai.html: /work/search?keyword=AI&open=1&sort=started
 * - search-category-system-budget.html: /work/search/system?open=1&sort=started&budget_from=10000
 * - search-category-system.html: budget_from なし(エージェント求人が30件中26件を占める)
 */
const keywordHtml = readFileSync('./tests/fixtures/search-keyword-ai.html', 'utf8');
const categoryBudgetHtml = readFileSync(
  './tests/fixtures/search-category-system-budget.html',
  'utf8',
);
const categoryNoBudgetHtml = readFileSync('./tests/fixtures/search-category-system.html', 'utf8');

describe('parseSearchResults', () => {
  it('キーワード検索ページから本物の案件を抽出する', () => {
    const items = parseSearchResults(keywordHtml);
    expect(items.length).toBe(23);
  });

  it('budget_from付きカテゴリページから案件を抽出する', () => {
    const items = parseSearchResults(categoryBudgetHtml);
    expect(items.length).toBe(24);
  });

  it('エージェント求人混入ページでも本物の案件だけを抽出する', () => {
    const items = parseSearchResults(categoryNoBudgetHtml);
    expect(items.length).toBe(4);
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/www\.lancers\.jp\/work\/detail\/\d+$/);
    }
  });

  it('タイトル・予算・残り日数・サブカテゴリを抽出する', () => {
    const items = parseSearchResults(categoryBudgetHtml);
    const first = items[0];
    expect(first?.url).toBe('https://www.lancers.jp/work/detail/5554049');
    expect(first?.title).toBe('AI・自動化実験パートナー募集｜継続案件あり');
    expect(first?.budgetText).toContain('20,000');
    expect(first?.budgetText).toContain('50,000');
    expect(first?.deadline).toBe('あと6日');
    expect(first?.category).toBe('ChatGPT開発');
  });

  it('タイトルにNEWタグやHTMLタグが残らない', () => {
    for (const item of parseSearchResults(keywordHtml)) {
      expect(item.title).not.toMatch(/^NEW/);
      expect(item.title).not.toMatch(/[<>]/);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('予算テキストはスコアラーの金額抽出と互換の形式になる', () => {
    const items = parseSearchResults(categoryBudgetHtml);
    const withBudget = items.filter((i) => i.budgetText);
    expect(withBudget.length).toBeGreaterThan(0);
    for (const item of withBudget) {
      expect(item.budgetText).toMatch(/[\d,]+\s*円/);
    }
  });

  it('案件一覧でないHTMLでは空配列を返す', () => {
    expect(parseSearchResults('<html><body>not a listing</body></html>')).toEqual([]);
  });
});
