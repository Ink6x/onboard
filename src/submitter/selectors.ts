/**
 * Lancers提案フォームのセレクタ定義。
 *
 * ⚠️ ログインが必要なページのため、実DOMは未確認(2026-06時点)。
 * 各セレクタは複数候補を配列で持ち、最初に見つかったものを使う方式にしている。
 * 初回は `npm run lancers:calibrate <案件URL>` で実フォームを開いてスクショ確認し、
 * 必要に応じてここを修正すること。
 *
 * 提案ページURL: https://www.lancers.jp/work/detail/<id>?purpose=lancer
 */

export interface SubmitSelectors {
  /** 提案ページへ遷移するための「提案する」導線(詳細ページから) */
  readonly proposeLink: readonly string[];
  /** 提案文の入力欄 */
  readonly proposalTextarea: readonly string[];
  /** 希望金額の入力欄 */
  readonly amountInput: readonly string[];
  /** 納期(日数)の入力欄 */
  readonly deliveryInput: readonly string[];
  /** 送信(提案する)ボタン */
  readonly submitButton: readonly string[];
  /** 送信完了の判定に使う要素・URLパターン */
  readonly successIndicator: readonly string[];
}

export const LANCERS_SELECTORS: SubmitSelectors = {
  proposeLink: [
    'a:has-text("案件に提案したい")',
    'a:has-text("提案する")',
    'a[href*="?purpose=lancer"]',
  ],
  proposalTextarea: [
    'textarea[name*="proposal"]',
    'textarea[name*="message"]',
    'textarea[name*="comment"]',
    'form textarea',
  ],
  amountInput: [
    'input[name*="amount"]',
    'input[name*="price"]',
    'input[name*="budget"]',
  ],
  deliveryInput: [
    'input[name*="period"]',
    'input[name*="delivery"]',
    'input[name*="term"]',
    'input[name*="days"]',
  ],
  submitButton: [
    'button:has-text("提案する")',
    'button:has-text("この内容で提案")',
    'input[type="submit"][value*="提案"]',
    'button[type="submit"]',
  ],
  successIndicator: [
    'text=提案を送信しました',
    'text=提案が完了',
    'text=応募が完了',
  ],
};

/**
 * 候補セレクタ配列の先頭からマッチする要素を探す。
 * 各候補に均等なタイムアウトを割り当て、先頭候補が存在しないだけで
 * 後続候補の待ち時間が枯渇しないようにする。
 */
export async function findFirst(
  page: import('playwright').Page,
  candidates: readonly string[],
  timeoutMs = 5000,
): Promise<import('playwright').Locator | null> {
  const perCandidate = Math.max(1000, Math.floor(timeoutMs / Math.max(1, candidates.length)));
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: perCandidate });
      return locator;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}
