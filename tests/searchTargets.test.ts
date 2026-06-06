import { describe, expect, it } from 'vitest';
import {
  INITIAL_ROTATION_STATE,
  buildSearchUrl,
  parseTargetList,
  planTick,
} from '../src/collector/searchTargets.js';

describe('parseTargetList', () => {
  it('カンマ区切りをトリムして配列化し、空要素を除く', () => {
    expect(parseTargetList(' AI, 自動化 ,,ChatGPT ')).toEqual(['AI', '自動化', 'ChatGPT']);
    expect(parseTargetList('')).toEqual([]);
  });
});

describe('buildSearchUrl', () => {
  it('キーワード検索URLを組み立てる(日本語はエンコード)', () => {
    const url = buildSearchUrl({ method: 'keyword', value: '自動化' }, 10000);
    expect(url).toBe(
      'https://www.lancers.jp/work/search?open=1&sort=started&budget_from=10000&keyword=%E8%87%AA%E5%8B%95%E5%8C%96',
    );
  });

  it('カテゴリ検索URLを組み立てる', () => {
    const url = buildSearchUrl({ method: 'category', value: 'system/ai' }, 10000);
    expect(url).toBe(
      'https://www.lancers.jp/work/search/system/ai?open=1&sort=started&budget_from=10000',
    );
  });

  it('budget_from=0 のときはパラメータを付けない', () => {
    const url = buildSearchUrl({ method: 'category', value: 'web' }, 0);
    expect(url).toBe('https://www.lancers.jp/work/search/web?open=1&sort=started');
  });
});

describe('planTick', () => {
  const keywords = ['k1', 'k2', 'k3', 'k4', 'k5'];
  const categories = ['c1', 'c2', 'c3'];

  it('方式をtickごとに交互に切り替える', () => {
    const tick1 = planTick(INITIAL_ROTATION_STATE, keywords, categories, 4);
    expect(tick1.targets.map((t) => t.method)).toEqual(['keyword', 'keyword', 'keyword', 'keyword']);
    expect(tick1.next.nextMethod).toBe('category');

    const tick2 = planTick(tick1.next, keywords, categories, 4);
    expect(tick2.targets.map((t) => t.method)).toEqual(['category', 'category', 'category']);
    expect(tick2.next.nextMethod).toBe('keyword');
  });

  it('カーソルが循環してリスト全体を順に消化する', () => {
    const tick1 = planTick(INITIAL_ROTATION_STATE, keywords, categories, 4);
    expect(tick1.targets.map((t) => t.value)).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect(tick1.next.keywordCursor).toBe(4);

    // 次のkeyword tick(間にcategory tickを挟む)
    const tick2 = planTick(tick1.next, keywords, categories, 4);
    const tick3 = planTick(tick2.next, keywords, categories, 4);
    expect(tick3.targets.map((t) => t.value)).toEqual(['k5', 'k1', 'k2', 'k3']);
  });

  it('リストがperTick以下なら全件を重複なく返す', () => {
    const tick = planTick(
      { ...INITIAL_ROTATION_STATE, nextMethod: 'category' },
      keywords,
      categories,
      4,
    );
    expect(tick.targets.map((t) => t.value)).toEqual(['c1', 'c2', 'c3']);
    expect(tick.next.categoryCursor).toBe(0);
  });

  it('片方のリストが空ならもう一方の方式を続ける', () => {
    const tick1 = planTick(INITIAL_ROTATION_STATE, keywords, [], 4);
    expect(tick1.targets.every((t) => t.method === 'keyword')).toBe(true);
    expect(tick1.next.nextMethod).toBe('keyword');

    const tick2 = planTick({ ...INITIAL_ROTATION_STATE, nextMethod: 'category' }, keywords, [], 4);
    expect(tick2.targets.every((t) => t.method === 'keyword')).toBe(true);
  });

  it('両方空ならターゲットなし', () => {
    const tick = planTick(INITIAL_ROTATION_STATE, [], [], 4);
    expect(tick.targets).toEqual([]);
  });
});
