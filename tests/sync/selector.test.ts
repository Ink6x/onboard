import { describe, expect, it } from 'vitest';
import { selectWorks } from '../../src/sync/selector.js';
import type { KbWork } from '../../src/sync/kbSchema.js';

function makeWork(slug: string, disclosure: KbWork['disclosure']): KbWork {
  return {
    slug,
    name: `実績 ${slug}`,
    disclosure,
    stack: [],
    links: {},
    sections: new Map(),
    relativePath: `works/${slug}.md`,
  };
}

const works = [
  makeWork('work-a', 'anonymized'),
  makeWork('work-b', 'public'),
  makeWork('work-secret', 'private'),
  makeWork('work-c', 'anonymized'),
];

describe('selectWorks', () => {
  it('allowlistの並び順で選別する', () => {
    const result = selectWorks(works, ['work-c', 'work-a']);
    expect(result.selected.map((w) => w.slug)).toEqual(['work-c', 'work-a']);
    expect(result.excludedPrivate).toEqual([]);
  });

  it('allowlistに無い実績は選ばれない', () => {
    const result = selectWorks(works, ['work-b']);
    expect(result.selected.map((w) => w.slug)).toEqual(['work-b']);
  });

  it('privateはallowlistにあっても強制除外する(二重ガード)', () => {
    const result = selectWorks(works, ['work-a', 'work-secret', 'work-b']);
    expect(result.selected.map((w) => w.slug)).toEqual(['work-a', 'work-b']);
    expect(result.excludedPrivate).toEqual(['work-secret']);
  });

  it('存在しないslugを指していたらthrowする(黙って欠落させない)', () => {
    expect(() => selectWorks(works, ['work-a', 'no-such-slug'])).toThrow(/no-such-slug/);
  });

  it('allowlistに重複があればthrowする', () => {
    expect(() => selectWorks(works, ['work-a', 'work-a'])).toThrow(/重複/);
  });

  it('選別結果が0件ならthrowする', () => {
    expect(() => selectWorks(works, ['work-secret'])).toThrow(/0件/);
  });
});
