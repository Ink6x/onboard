/**
 * profile.yaml の現行と生成結果の差分表示(承認前の人間確認用)。
 * 依存を増やさないため、LCSベースの素朴な行diffを自前実装する(対象は数百行程度)。
 */

export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

export interface DiffResult {
  /** `+ ` / `- ` / `  ` プレフィクスつきの行diff(変更が無ければ空文字) */
  readonly text: string;
  readonly stats: DiffStats;
  readonly hasChanges: boolean;
}

/** 変更箇所の前後に残す文脈行数 */
const CONTEXT_LINES = 2;

export function diffLines(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.replace(/\r\n/g, '\n').split('\n');
  const newLines = newText.replace(/\r\n/g, '\n').split('\n');

  // LCSテーブル(行数は profile.yaml 規模なのでO(n*m)で十分)
  const n = oldLines.length;
  const m = newLines.length;
  const at = (lines: readonly string[], index: number): string => lines[index] ?? '';
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] ?? [];
    const nextRow = lcs[i + 1] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        at(oldLines, i) === at(newLines, j)
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const lcsAt = (i: number, j: number): number => lcs[i]?.[j] ?? 0;

  // バックトラックして行単位の編集列を作る
  const ops: { kind: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at(oldLines, i) === at(newLines, j)) {
      ops.push({ kind: ' ', line: at(oldLines, i) });
      i++;
      j++;
    } else if (lcsAt(i + 1, j) >= lcsAt(i, j + 1)) {
      ops.push({ kind: '-', line: at(oldLines, i) });
      i++;
    } else {
      ops.push({ kind: '+', line: at(newLines, j) });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', line: at(oldLines, i) });
  for (; j < m; j++) ops.push({ kind: '+', line: at(newLines, j) });

  const added = ops.filter((op) => op.kind === '+').length;
  const removed = ops.filter((op) => op.kind === '-').length;
  if (added === 0 && removed === 0) {
    return { text: '', stats: { added: 0, removed: 0 }, hasChanges: false };
  }

  // 変更箇所の周辺だけを残す(全文表示は長すぎるため)
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.kind === ' ') return;
    for (let c = Math.max(0, k - CONTEXT_LINES); c <= Math.min(ops.length - 1, k + CONTEXT_LINES); c++) {
      keep[c] = true;
    }
  });
  const parts: string[] = [];
  let inGap = false;
  ops.forEach((op, k) => {
    if (!keep[k]) {
      if (!inGap) {
        parts.push('  ...');
        inGap = true;
      }
      return;
    }
    inGap = false;
    parts.push(`${op.kind} ${op.line}`);
  });

  return { text: parts.join('\n'), stats: { added, removed }, hasChanges: true };
}
