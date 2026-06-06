/**
 * Lancers検索一覧の巡回ターゲット定義とローテーション計画(純関数)。
 *
 * 設計方針: リクエスト予算の固定化。
 * 1tickあたり最大 perTick 件の検索URLだけ巡回し、tickごとに
 * キーワード検索とカテゴリ検索を交互に切り替える。リストを増やしても
 * Lancersへのアクセス頻度は一定のまま、各ターゲットの巡回周期だけが伸びる。
 */

export type SearchMethod = 'keyword' | 'category';

export interface SearchTarget {
  readonly method: SearchMethod;
  readonly value: string; // キーワード文字列 or カテゴリパス(例: system/ai)
}

/** ローテーションの永続状態(SQLiteにJSONで保存される)。 */
export interface RotationState {
  readonly nextMethod: SearchMethod;
  readonly keywordCursor: number;
  readonly categoryCursor: number;
}

export interface TickPlan {
  readonly targets: readonly SearchTarget[];
  readonly next: RotationState;
}

export const INITIAL_ROTATION_STATE: RotationState = {
  nextMethod: 'keyword',
  keywordCursor: 0,
  categoryCursor: 0,
};

/** カンマ区切りの環境変数値をトリム済み配列にする。 */
export function parseTargetList(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 検索一覧URLを組み立てる。open=1(募集中のみ)+sort=started(新着順)固定。
 * budget_from はエージェント求人(tech-agent)の混入を減らす効果もある
 * (実測: systemカテゴリで本物の案件が 4件/30件 → 24件/30件 に改善)。
 */
export function buildSearchUrl(target: SearchTarget, budgetFromYen: number): string {
  const params = new URLSearchParams({ open: '1', sort: 'started' });
  if (budgetFromYen > 0) params.set('budget_from', String(budgetFromYen));
  if (target.method === 'keyword') {
    params.set('keyword', target.value);
    return `https://www.lancers.jp/work/search?${params.toString()}`;
  }
  return `https://www.lancers.jp/work/search/${target.value}?${params.toString()}`;
}

/**
 * 今回のtickで巡回するターゲットと、次回のローテーション状態を計算する。
 * - nextMethod のリストが空なら、もう一方の方式に自動フォールバック
 * - 両方空なら targets は空(巡回なし)
 */
export function planTick(
  state: RotationState,
  keywords: readonly string[],
  categories: readonly string[],
  perTick: number,
): TickPlan {
  const method = resolveMethod(state.nextMethod, keywords, categories);
  if (!method) {
    return { targets: [], next: state };
  }

  const list = method === 'keyword' ? keywords : categories;
  const cursor = method === 'keyword' ? state.keywordCursor : state.categoryCursor;
  const { items, nextCursor } = takeWrapped(list, cursor, perTick);

  const targets = items.map((value): SearchTarget => ({ method, value }));
  const other: SearchMethod = method === 'keyword' ? 'category' : 'keyword';
  const otherList = other === 'keyword' ? keywords : categories;

  return {
    targets,
    next: {
      // 次回は方式を切り替える(もう一方が空なら同じ方式を続ける)
      nextMethod: otherList.length > 0 ? other : method,
      keywordCursor: method === 'keyword' ? nextCursor : state.keywordCursor,
      categoryCursor: method === 'category' ? nextCursor : state.categoryCursor,
    },
  };
}

function resolveMethod(
  preferred: SearchMethod,
  keywords: readonly string[],
  categories: readonly string[],
): SearchMethod | null {
  if (preferred === 'keyword' && keywords.length > 0) return 'keyword';
  if (preferred === 'category' && categories.length > 0) return 'category';
  if (keywords.length > 0) return 'keyword';
  if (categories.length > 0) return 'category';
  return null;
}

/** cursor位置からn件を循環的に取り出す(リストがn以下なら全件・カーソル0リセット)。 */
function takeWrapped<T>(
  list: readonly T[],
  cursor: number,
  n: number,
): { items: readonly T[]; nextCursor: number } {
  if (list.length === 0) return { items: [], nextCursor: 0 };
  const safeCursor = ((cursor % list.length) + list.length) % list.length;
  const count = Math.min(n, list.length);
  const items = Array.from({ length: count }, (_, i) => list[(safeCursor + i) % list.length] as T);
  const nextCursor = list.length > n ? (safeCursor + n) % list.length : 0;
  return { items, nextCursor };
}
