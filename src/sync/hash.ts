import { createHash } from 'node:crypto';

/**
 * KB→profile.yaml 同期の鮮度管理。
 * 同期時にKB入力ファイルのコンテンツハッシュを .kb-sync.json に記録し、
 * onboard 起動時に現在のKBと照合して「profile.yaml が古い」ことを検知する。
 */

export interface KbSyncRecord {
  /** 同期を実行した時刻(ISO 8601) */
  readonly generatedAt: string;
  /** KBルートからの相対パス → sha256(改行コード正規化済み) */
  readonly files: Readonly<Record<string, string>>;
}

export interface KbDriftResult {
  /** 内容が変わったファイル */
  readonly changed: readonly string[];
  /** 同期後に追加されたファイル */
  readonly added: readonly string[];
  /** 同期後に削除されたファイル */
  readonly removed: readonly string[];
}

/** 改行コード差(CRLF/LF)で誤検知しないよう正規化してから sha256 を取る。 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function buildSyncRecord(
  fileContents: Readonly<Record<string, string>>,
  generatedAt: string,
): KbSyncRecord {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(fileContents)) {
    files[path] = hashContent(content);
  }
  return { generatedAt, files };
}

/** 記録時点のKBと現在のKBの差分を求める。差分なし = すべて空配列。 */
export function detectKbDrift(
  record: KbSyncRecord,
  currentFileContents: Readonly<Record<string, string>>,
): KbDriftResult {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [path, hash] of Object.entries(record.files)) {
    const current = currentFileContents[path];
    if (current === undefined) {
      removed.push(path);
    } else if (hashContent(current) !== hash) {
      changed.push(path);
    }
  }
  for (const path of Object.keys(currentFileContents)) {
    if (!(path in record.files)) added.push(path);
  }
  return { changed, added, removed };
}

export function hasDrift(drift: KbDriftResult): boolean {
  return drift.changed.length > 0 || drift.added.length > 0 || drift.removed.length > 0;
}
