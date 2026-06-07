import type { KbWork } from './kbSchema.js';

/**
 * Lancers に掲載する実績の選別。
 * channels.md の allowlist(slug列挙・並び順そのまま)を正としつつ、
 * frontmatter `disclosure: private` は allowlist に載っていても強制除外する(二重ガード)。
 */

export interface SelectionResult {
  /** allowlist の並び順で選別された実績 */
  readonly selected: readonly KbWork[];
  /** private のため強制除外された slug(呼び出し側で警告表示する) */
  readonly excludedPrivate: readonly string[];
}

export function selectWorks(allWorks: readonly KbWork[], allowlist: readonly string[]): SelectionResult {
  const bySlug = new Map(allWorks.map((w) => [w.slug, w]));

  const duplicates = allowlist.filter((slug, i) => allowlist.indexOf(slug) !== i);
  if (duplicates.length > 0) {
    throw new Error(`channels.md の lancers_works に重複があります: ${duplicates.join(', ')}`);
  }

  const selected: KbWork[] = [];
  const excludedPrivate: string[] = [];
  for (const slug of allowlist) {
    const work = bySlug.get(slug);
    if (!work) {
      // allowlist が存在しない実績を指している = KB側の設定ミス。黙って欠落させない
      throw new Error(
        `channels.md の lancers_works にある "${slug}" に対応する works/*.md が見つかりません(frontmatter slug を確認してください)`,
      );
    }
    if (work.disclosure === 'private') {
      excludedPrivate.push(slug);
      continue;
    }
    selected.push(work);
  }

  if (selected.length === 0) {
    throw new Error('Lancers 掲載対象の実績が0件です(allowlist と disclosure を確認してください)');
  }
  return { selected, excludedPrivate };
}
