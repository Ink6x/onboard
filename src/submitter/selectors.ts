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
  /** 詳細ページから提案フォームへ遷移する「提案する」導線 */
  readonly proposeLink: readonly string[];
  /** 提案文の入力欄 */
  readonly proposalTextarea: readonly string[];
  /** 秘密保持契約(NDA)同意チェックボックス。案件により出ないこともある */
  readonly ndaCheckbox: readonly string[];
  /** 計画の契約金額(税抜)入力欄 */
  readonly amountInput: readonly string[];
  /** 計画の完了予定日(日付)入力欄 */
  readonly completionDateInput: readonly string[];
  /** 送信(同意して提案する)ボタン */
  readonly submitButton: readonly string[];
  /** 送信完了の判定に使う要素 */
  readonly successIndicator: readonly string[];
}

/**
 * 2026-06 にログイン状態の実フォーム(/work/propose_start/<id>)で確認した構造に基づく。
 * 詳細は docs/propose-form.md。計画フィールドはname属性が無いため、
 * 構造ベース(計画ブロック内の特定input)で狙う。
 */
export const LANCERS_SELECTORS: SubmitSelectors = {
  proposeLink: [
    'a:has-text("提案する")',
    'button:has-text("提案する")',
    'a:has-text("案件に提案したい")',
  ],
  proposalTextarea: [
    '#ProposalDescription',
    'textarea[name="data[Proposal][description]"]',
  ],
  ndaCheckbox: [
    // 「秘密保持契約の内容を確認した上で同意します」のチェックボックス
    'input[type="checkbox"][name*="agree"]',
    'input[type="checkbox"][name*="nda"]',
    'input[type="checkbox"][name*="Nda"]',
  ],
  amountInput: [
    // 計画の契約金額。ProposalOption[N]はnameを持つので、name無しのnumberを狙う
    'input[type="number"]:not([name])',
  ],
  completionDateInput: [
    'input[name*="delivery_date"]',
    'input[name*="deadline"]',
    'input[type="date"]',
  ],
  submitButton: [
    '#form_end',
    'input[name="send"]',
    'input[type="submit"][value*="同意して提案する"]',
  ],
  successIndicator: [
    'text=提案を送信しました',
    'text=提案が完了',
    'text=ご提案ありがとうございます',
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
