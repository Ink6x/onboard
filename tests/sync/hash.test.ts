import { describe, expect, it } from 'vitest';
import { buildSyncRecord, detectKbDrift, hasDrift, hashContent } from '../../src/sync/hash.js';

describe('hashContent', () => {
  it('同一内容は同一ハッシュ', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
  });

  it('改行コード差(CRLF/LF)では変わらない', () => {
    expect(hashContent('a\r\nb')).toBe(hashContent('a\nb'));
  });

  it('内容が違えば変わる', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('buildSyncRecord / detectKbDrift', () => {
  const original = { 'works/a.md': 'A', 'texts/b.md': 'B' };
  const record = buildSyncRecord(original, '2026-06-07T00:00:00Z');

  it('変更なしならドリフトなし', () => {
    const drift = detectKbDrift(record, { ...original });
    expect(hasDrift(drift)).toBe(false);
  });

  it('内容変更をchangedとして検出する', () => {
    const drift = detectKbDrift(record, { ...original, 'works/a.md': 'A改' });
    expect(drift.changed).toEqual(['works/a.md']);
    expect(hasDrift(drift)).toBe(true);
  });

  it('追加・削除を検出する', () => {
    const drift = detectKbDrift(record, { 'works/a.md': 'A', 'works/new.md': 'N' });
    expect(drift.removed).toEqual(['texts/b.md']);
    expect(drift.added).toEqual(['works/new.md']);
  });

  it('recordに生成時刻が記録される', () => {
    expect(record.generatedAt).toBe('2026-06-07T00:00:00Z');
  });
});
