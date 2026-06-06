import { describe, expect, it } from 'vitest';
import { isPrivatePlaceholder } from '../src/collector/webCollector.js';

describe('isPrivatePlaceholder', () => {
  it('限定公開のプレースホルダタイトルを判定する', () => {
    expect(isPrivatePlaceholder('限定公開の仕事')).toBe(true);
    expect(isPrivatePlaceholder('【限定公開】案件')).toBe(true);
  });

  it('通常のタイトルは対象外', () => {
    expect(isPrivatePlaceholder('AI・自動化実験パートナー募集｜継続案件あり')).toBe(false);
    expect(isPrivatePlaceholder('ChatGPTを使った業務効率化')).toBe(false);
  });
});
