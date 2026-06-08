import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSyncRecord } from '../../src/sync/hash.js';
import { collectKbFileContents } from '../../src/sync/kbReader.js';
import { checkProfileStaleness } from '../../src/sync/staleness.js';

/** 最小構成のKBディレクトリをtempに作る。 */
function writeMiniKb(dir: string): void {
  mkdirSync(join(dir, 'channels'), { recursive: true });
  mkdirSync(join(dir, 'profile'), { recursive: true });
  mkdirSync(join(dir, 'texts'), { recursive: true });
  mkdirSync(join(dir, 'works'), { recursive: true });
  writeFileSync(join(dir, 'DISCLOSURE.md'), 'disclosure', 'utf8');
  writeFileSync(join(dir, 'channels', 'channels.md'), 'channels', 'utf8');
  writeFileSync(join(dir, 'profile', 'profile.md'), 'profile', 'utf8');
  writeFileSync(join(dir, 'profile', 'career.md'), 'career', 'utf8');
  writeFileSync(join(dir, 'texts', 'self-pr.md'), 'selfpr', 'utf8');
  writeFileSync(join(dir, 'texts', 'intro.md'), 'intro', 'utf8');
  writeFileSync(join(dir, 'texts', 'outcomes.md'), 'outcomes', 'utf8');
  writeFileSync(join(dir, 'works', 'sample.md'), 'work', 'utf8');
}

describe('checkProfileStaleness', () => {
  let root: string;
  let kbDir: string;
  let recordPath: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'onboard-staleness-'));
    kbDir = join(root, 'kb');
    recordPath = join(root, '.kb-sync.json');
    mkdirSync(kbDir);
    writeMiniKb(kbDir);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('鮮度記録が無ければ unsynced', () => {
    expect(checkProfileStaleness(kbDir, join(root, 'no-such.json')).status).toBe('unsynced');
  });

  it('壊れた鮮度記録は unsynced 扱い', () => {
    const broken = join(root, 'broken.json');
    writeFileSync(broken, '{not json', 'utf8');
    expect(checkProfileStaleness(kbDir, broken).status).toBe('unsynced');
  });

  it('KBと一致していれば fresh', () => {
    const record = buildSyncRecord(collectKbFileContents(kbDir), '2026-06-07T00:00:00Z');
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');
    expect(checkProfileStaleness(kbDir, recordPath).status).toBe('fresh');
  });

  it('同期後にKBが変わったら stale になり、変更ファイルを報告する', () => {
    const record = buildSyncRecord(collectKbFileContents(kbDir), '2026-06-07T00:00:00Z');
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');
    writeFileSync(join(kbDir, 'works', 'sample.md'), 'work-改', 'utf8');
    const report = checkProfileStaleness(kbDir, recordPath);
    expect(report.status).toBe('stale');
    expect(report.drift?.changed).toContain('works/sample.md');
    expect(report.message).toContain('profile:sync');
  });

  it('KBが読めない場合は unavailable(起動を止めない)', () => {
    expect(checkProfileStaleness(join(root, 'no-kb'), recordPath).status).toBe('unavailable');
  });
});
