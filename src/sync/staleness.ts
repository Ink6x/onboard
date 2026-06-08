import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { detectKbDrift, hasDrift, type KbDriftResult, type KbSyncRecord } from './hash.js';
import { collectKbFileContents } from './kbReader.js';

/**
 * profile.yaml の鮮度チェック。
 * 同期時に記録した .kb-sync.json と現在のKBを照合し、KBが更新されていれば
 * 「profile.yaml が古い」ことを報告する。起動を止めない(警告のみ)前提の設計。
 */

const syncRecordSchema = z.object({
  generatedAt: z.string(),
  files: z.record(z.string()),
});

export type StalenessStatus =
  | 'fresh' // KBと一致(最新)
  | 'stale' // KBが同期後に更新されている
  | 'unsynced' // .kb-sync.json が無い(まだ一度も同期していない)
  | 'unavailable'; // KBが読めない(別マシン等)。判定不能

export interface StalenessReport {
  readonly status: StalenessStatus;
  /** ログ向けの説明(1行) */
  readonly message: string;
  /** stale のときの差分詳細 */
  readonly drift?: KbDriftResult;
}

export function checkProfileStaleness(kbDir: string, recordPath: string): StalenessReport {
  if (!existsSync(recordPath)) {
    return {
      status: 'unsynced',
      message: `鮮度記録(${recordPath})がありません。npm run profile:sync で同期してください`,
    };
  }

  let record: KbSyncRecord;
  try {
    record = syncRecordSchema.parse(JSON.parse(readFileSync(recordPath, 'utf8')));
  } catch {
    return {
      status: 'unsynced',
      message: `鮮度記録(${recordPath})が壊れています。npm run profile:sync で再同期してください`,
    };
  }

  let current: Record<string, string>;
  try {
    current = collectKbFileContents(kbDir);
  } catch {
    return {
      status: 'unavailable',
      message: `KB(${kbDir})が読めないため鮮度を判定できません`,
    };
  }

  const drift = detectKbDrift(record, current);
  if (!hasDrift(drift)) {
    return { status: 'fresh', message: `profile.yaml はKBと同期済みです(同期: ${record.generatedAt})` };
  }

  const parts = [
    drift.changed.length > 0 ? `変更: ${drift.changed.join(', ')}` : '',
    drift.added.length > 0 ? `追加: ${drift.added.join(', ')}` : '',
    drift.removed.length > 0 ? `削除: ${drift.removed.join(', ')}` : '',
  ].filter((p) => p.length > 0);
  return {
    status: 'stale',
    message: `KBが同期後に更新されています(${parts.join(' / ')})。npm run profile:sync で profile.yaml を更新してください`,
    drift,
  };
}
