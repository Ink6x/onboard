/**
 * スコアリング用キーワード一致判定。
 *
 * 英数字キーワード(AI, LINE, GAS等)は素朴な部分一致だと英単語の内部に
 * 誤一致する(例: det"ai"l, On"line")。実データでは「AI」がほぼ全案件に
 * 一致してしまい、経理・総務募集まで通知される原因になった。
 * そこで英数字キーワードは前後が英数字でない場合のみ一致とみなす。
 * 日本語キーワードは分かち書きできないため従来どおり部分一致。
 */

const ASCII_KEYWORD_RE = /^[\x20-\x7e]+$/;

/** RegExpの特殊文字をエスケープする(Next.js 等の記号入りキーワード対応)。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matcherCache = new Map<string, (text: string) => boolean>();

/**
 * キーワードの一致判定関数を返す(コンパイル済みRegExpをキャッシュ)。
 * 渡すテキストは小文字化済みであること。
 */
function getMatcher(keyword: string): (text: string) => boolean {
  // キャッシュキーは小文字に正規化する(同一キーワードの別表記で重複コンパイルしない)
  const lower = keyword.toLowerCase();
  const cached = matcherCache.get(lower);
  if (cached) return cached;

  const matcher = ASCII_KEYWORD_RE.test(keyword)
    ? (() => {
        const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(lower)}(?![a-z0-9])`);
        return (text: string) => re.test(text);
      })()
    : (text: string) => text.includes(lower);

  matcherCache.set(lower, matcher);
  return matcher;
}

/** キーワードがテキストに一致するか。textは小文字化済みであること。 */
export function matchKeyword(lowerText: string, keyword: string): boolean {
  return getMatcher(keyword)(lowerText);
}

/** 一致したキーワードの一覧を返す。textは小文字化済みであること。 */
export function findMatches(lowerText: string, keywords: readonly string[]): readonly string[] {
  return keywords.filter((keyword) => matchKeyword(lowerText, keyword));
}
