/**
 * 禁止語(社名・実名・サービス名等)の決定論的スキャン。
 * LLMの匿名化を信用せず、生成物は必ずここを通す(最終防壁・fail-closed)。
 *
 * 検査の正規化:
 * - NFKC(全角/半角の同一視) + 小文字化 + カタカナ→ひらがな(読み仮名の表記ゆれ対策)
 * - 空白・ゼロ幅文字を除去したテキストtoo検査(「C T O」のような分かち書き挿入のすり抜けを防ぐ)
 * - 短い英字語(例: CTO)は語境界つき一致(constructor / Vector 等の偽陽性を防ぐ)
 * - 長い英字語(例: michibiki)は部分一致(ドメイン連結 "michibikugroup" も捕まえる)
 */

/**
 * 語境界チェックを適用する英数字語の最大長。
 * 例: "CTO"(3字)は "vector"/"constructor" に部分一致してしまうため境界つきで検査する。
 * 5字以上(例: "michibiki")は偶然の部分一致がほぼ起きず、むしろ "michibikugroup" のような
 * 連結を捕まえたいので部分一致にする。
 */
const BOUNDARY_CHECK_MAX_LENGTH = 4;

/** 誤って禁止語リストが空に近い状態で「検査合格」になる事故を防ぐ下限 */
const MIN_FORBIDDEN_TERMS = 5;

export function normalizeForScan(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // カタカナ→ひらがな(U+30A1〜U+30F6 を -0x60 シフト)。「ミチビク」と「みちびく」を同一視する
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 空白・ゼロ幅文字の挿入によるすり抜けを防ぐための圧縮形。 */
function squashForScan(normalized: string): string {
  // \u200b〜\u200d(ゼロ幅文字)と \ufeff(BOM)は NFKC 後も残る不可視文字のため空白と同様に除去する
  return normalized.replace(/[\s\u200b-\u200d\ufeff]+/g, '');
}

function isAsciiTerm(term: string): boolean {
  return /^[\x20-\x7e]+$/.test(term);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 禁止語リストの妥当性検証。少なすぎる場合は設定事故とみなして throw(fail-closed)。 */
export function assertDenylistUsable(terms: readonly string[]): void {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length < MIN_FORBIDDEN_TERMS) {
    throw new Error(
      `禁止語リストが${cleaned.length}件しかありません(下限${MIN_FORBIDDEN_TERMS}件)。` +
        'DISCLOSURE.md の forbidden_terms が壊れている可能性があるため同期を中止します(fail-closed)',
    );
  }
}

/**
 * テキストに含まれる禁止語を返す(空配列 = 合格)。
 * 戻り値はヒットした禁止語の一覧(重複なし・入力リスト順)。
 */
export function scanForbiddenTerms(text: string, terms: readonly string[]): readonly string[] {
  assertDenylistUsable(terms);
  const normalized = normalizeForScan(text);
  const squashed = squashForScan(normalized);

  const hits: string[] = [];
  for (const rawTerm of terms) {
    const term = normalizeForScan(rawTerm.trim());
    if (term.length === 0) continue;

    if (isAsciiTerm(term) && term.length <= BOUNDARY_CHECK_MAX_LENGTH) {
      // 短い英字語: 前後が英数字でない位置のみヒット(例: "CTO" は捕まえ、"constructor" は無視)。
      // 空白挿入(「C T O」)のすり抜けを防ぐため、空白ありと空白除去の両方を検査する
      const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`);
      if (pattern.test(normalized) || pattern.test(squashed)) hits.push(rawTerm);
    } else if (normalized.includes(term) || squashed.includes(term)) {
      hits.push(rawTerm);
    }
  }
  return hits;
}
