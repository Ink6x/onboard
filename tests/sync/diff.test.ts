import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/sync/diff.js';

describe('diffLines', () => {
  it('同一テキストは差分なし', () => {
    const result = diffLines('a\nb\nc', 'a\nb\nc');
    expect(result.hasChanges).toBe(false);
    expect(result.text).toBe('');
  });

  it('追加・削除行を検出する', () => {
    const result = diffLines('a\nb\nc', 'a\nX\nc');
    expect(result.hasChanges).toBe(true);
    expect(result.stats).toEqual({ added: 1, removed: 1 });
    expect(result.text).toContain('- b');
    expect(result.text).toContain('+ X');
  });

  it('変更のない離れた箇所は ... で省略する', () => {
    const oldText = ['x', ...Array.from({ length: 20 }, (_, i) => `same${i}`), 'y'].join('\n');
    const newText = ['x2', ...Array.from({ length: 20 }, (_, i) => `same${i}`), 'y2'].join('\n');
    const result = diffLines(oldText, newText);
    expect(result.text).toContain('  ...');
    expect(result.text).toContain('- x');
    expect(result.text).toContain('+ y2');
  });

  it('空からの新規作成は全行追加', () => {
    const result = diffLines('', 'a\nb');
    expect(result.stats.added).toBeGreaterThanOrEqual(2);
    expect(result.stats.removed).toBeLessThanOrEqual(1); // 空文字は1つの空行とみなされる
  });

  it('CRLFとLFの差は差分にしない', () => {
    expect(diffLines('a\r\nb', 'a\nb').hasChanges).toBe(false);
  });
});
