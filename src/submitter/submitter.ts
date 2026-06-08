import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Job } from '../types.js';
import type { BidValues } from './bidValues.js';
import { launchBrowser, isLoggedIn, type BrowserSession } from './browser.js';
import { withBrowserLock } from './browserLock.js';
import { LANCERS_SELECTORS, findFirst } from './selectors.js';

export type SubmitStage = 'fill' | 'submit';

export type SubmitResult =
  | { readonly status: 'filled'; readonly screenshotPath: string } // 入力完了・最終確認待ち
  | { readonly status: 'submitted'; readonly screenshotPath: string }
  | { readonly status: 'needs_login' }
  | { readonly status: 'error'; readonly message: string; readonly screenshotPath: string | null };

export interface SubmitterOptions {
  readonly profileDir: string;
  readonly headless: boolean;
  readonly screenshotDir: string;
  readonly executablePath?: string;
  readonly channel?: string;
}

/**
 * Lancers提案フォームへの自動入力・送信を担う。2段階確認のため、
 * stage='fill' で入力+スクショまで(送信しない)、stage='submit' で送信を行う。
 *
 * ⚠️ stage間はブラウザを開いたままにできないため(プロセス常駐前提)、
 * このクラスは1回の操作ごとにブラウザを起動・クローズする。fillで入力した内容は
 * ページを閉じると失われるため、submit時はもう一度フォームに入力してから送信する。
 * これにより「fillのスクショ確認 → submitで再入力して即送信」が成立する。
 */
export class LancersSubmitter {
  constructor(private readonly options: SubmitterOptions) {
    mkdirSync(options.screenshotDir, { recursive: true });
  }

  async run(job: Job, bid: BidValues, proposalText: string, stage: SubmitStage): Promise<SubmitResult> {
    // 共有プロファイルの同時起動を防ぐ(Webログイン巡回と排他)
    return withBrowserLock(() => this.runLocked(job, bid, proposalText, stage));
  }

  private async runLocked(
    job: Job,
    bid: BidValues,
    proposalText: string,
    stage: SubmitStage,
  ): Promise<SubmitResult> {
    let session: BrowserSession | null = null;
    try {
      session = await launchBrowser({
        profileDir: this.options.profileDir,
        headless: this.options.headless,
        ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
        ...(this.options.channel ? { channel: this.options.channel } : {}),
      });

      // withPage で包み、処理完了/例外いずれでも該当タブを必ず閉じる
      return await session.withPage(async (page): Promise<SubmitResult> => {
        if (!(await isLoggedIn(page))) {
          return { status: 'needs_login' };
        }

        await this.openProposalForm(page, job.url);
        await this.fillForm(page, proposalText, bid);

        const shotName = `job-${job.id}-${stage}.png`;
        const screenshotPath = `${this.options.screenshotDir}/${shotName}`;
        await page.screenshot({ path: screenshotPath, fullPage: true });

        if (stage === 'fill') {
          return { status: 'filled', screenshotPath };
        }

        // stage === 'submit': 提案フォームは 入力 → 確認 → 完了 の3ステップ。
        // ① 入力ページの「同意して提案する」(#form_end)で確認ページへ進む
        const submitButton = await findFirst(page, LANCERS_SELECTORS.submitButton);
        if (!submitButton) {
          return { status: 'error', message: '送信ボタン(入力→確認)が見つかりませんでした', screenshotPath };
        }
        await submitButton.click();

        // ② 確認ページの「利用規約に同意して提案する」で実際に送信する
        const finalButton = await findFirst(page, LANCERS_SELECTORS.finalSubmitButton, 10000);
        if (!finalButton) {
          const confirmShot = `${this.options.screenshotDir}/job-${job.id}-confirm.png`;
          await page.screenshot({ path: confirmShot, fullPage: true });
          return {
            status: 'error',
            message: '確認ページの最終送信ボタンが見つかりませんでした(入力エラーの可能性)',
            screenshotPath: confirmShot,
          };
        }
        await finalButton.click();
        await page.waitForTimeout(3500);

        const resultShot = `${this.options.screenshotDir}/job-${job.id}-result.png`;
        await page.screenshot({ path: resultShot, fullPage: true });

        const success = await this.detectSuccess(page);
        if (!success) {
          return {
            status: 'error',
            message: '送信完了を確認できませんでした(結果スクショを確認してください)',
            screenshotPath: resultShot,
          };
        }
        return { status: 'submitted', screenshotPath: resultShot };
      });
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        screenshotPath: null,
      };
    } finally {
      await session?.close();
    }
  }

  /**
   * 詳細ページから提案フォーム(/work/propose_start/<id>)へ遷移する。
   * 詳細ページの「提案する」を押すとフォームページへ移動する。
   */
  private async openProposalForm(page: Page, jobUrl: string): Promise<void> {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const proposeLink = await findFirst(page, LANCERS_SELECTORS.proposeLink, 4000);
    if (!proposeLink) {
      throw new Error('「提案する」ボタンが見つかりません(募集終了の可能性)');
    }
    await proposeLink.click();
    // フォームページ(提案文欄)の出現を待つ
    const textarea = await findFirst(page, LANCERS_SELECTORS.proposalTextarea, 8000);
    if (!textarea) {
      throw new Error('提案フォームの読み込みに失敗しました');
    }
  }

  private async fillForm(page: Page, proposalText: string, bid: BidValues): Promise<void> {
    // 提案文(必須)
    const textarea = await findFirst(page, LANCERS_SELECTORS.proposalTextarea);
    if (!textarea) throw new Error('提案文の入力欄が見つかりませんでした');
    await textarea.fill(proposalText);

    // 計画の契約金額(税抜)。既定値が入っているのでクリアしてから入れる
    const amount = await findFirst(page, LANCERS_SELECTORS.amountInput, 2000);
    if (amount) {
      await amount.fill('');
      await amount.fill(String(bid.amountYen));
    }

    // 完了予定日(必須・react-datepicker)。形式が合わないと反映されないため適応入力
    const dateInput = await findFirst(page, LANCERS_SELECTORS.completionDateInput, 2000);
    if (dateInput) {
      await fillDatePicker(dateInput, bid.deliveryDays);
    }

    // NDA同意チェック(ある案件のみ)。disabledはクラス名なのでforceでクリックする
    const nda = await findFirst(page, LANCERS_SELECTORS.ndaCheckbox, 1500);
    if (nda) {
      await nda.check({ force: true }).catch(() => undefined);
    }
  }

  private async detectSuccess(page: Page): Promise<boolean> {
    for (const indicator of LANCERS_SELECTORS.successIndicator) {
      if ((await page.locator(indicator).count()) > 0) return true;
    }
    // 完了URLパターン(/proposeや/completeへ遷移)
    if (/\/(complete|thanks|done|propose_complete|proposed)/i.test(page.url())) return true;
    // フォールバック: 確認ページの最終ボタンが消えていれば完了ページへ遷移したとみなす。
    // (送信失敗なら確認ページに留まり最終ボタンが残るため)
    const stillOnConfirm = await findFirst(page, LANCERS_SELECTORS.finalSubmitButton, 1500);
    return stillOnConfirm === null;
  }
}

/** 今日からN日後の年月日を返す。 */
function addDays(days: number): { y: number; m: number; d: number } {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

/**
 * react-datepicker のテキスト入力へ日付を反映する。
 * dateFormatが不明なため、yyyy/MM/dd → 反映されなければ MM/dd/yyyy の順で試す。
 * 入力後Enterで確定し、value が入ったかで成否を判定する。
 */
async function fillDatePicker(input: import('playwright').Locator, deliveryDays: number): Promise<void> {
  const { y, m, d } = addDays(deliveryDays);
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const formats = [`${y}/${mm}/${dd}`, `${mm}/${dd}/${y}`, `${y}-${mm}-${dd}`];

  for (const value of formats) {
    await input.click();
    await input.fill('');
    await input.type(value, { delay: 20 });
    await input.press('Enter');
    const current = await input.inputValue().catch(() => '');
    if (current.trim().length > 0) return; // 反映された
  }
  // どの形式でも反映されない場合は、人間が最終確認スクショで気づける(送信前確認)
}
