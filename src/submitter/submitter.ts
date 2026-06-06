import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Job } from '../types.js';
import type { BidValues } from './bidValues.js';
import { launchBrowser, isLoggedIn, type BrowserSession } from './browser.js';
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
    let session: BrowserSession | null = null;
    try {
      session = await launchBrowser(this.options.profileDir, this.options.headless);
      const page = await session.newPage();

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

      // stage === 'submit': 送信ボタンを押す
      const submitButton = await findFirst(page, LANCERS_SELECTORS.submitButton);
      if (!submitButton) {
        return { status: 'error', message: '送信ボタンが見つかりませんでした', screenshotPath };
      }
      await submitButton.click();
      await page.waitForTimeout(3000);

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

  private async openProposalForm(page: Page, jobUrl: string): Promise<void> {
    const proposeUrl = jobUrl.includes('?') ? `${jobUrl}&purpose=lancer` : `${jobUrl}?purpose=lancer`;
    await page.goto(proposeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  private async fillForm(page: Page, proposalText: string, bid: BidValues): Promise<void> {
    const textarea = await findFirst(page, LANCERS_SELECTORS.proposalTextarea);
    if (!textarea) throw new Error('提案文の入力欄が見つかりませんでした');
    await textarea.fill(proposalText);

    const amount = await findFirst(page, LANCERS_SELECTORS.amountInput, 2000);
    if (amount) await amount.fill(String(bid.amountYen));

    const delivery = await findFirst(page, LANCERS_SELECTORS.deliveryInput, 2000);
    if (delivery) await delivery.fill(String(bid.deliveryDays));
  }

  private async detectSuccess(page: Page): Promise<boolean> {
    for (const indicator of LANCERS_SELECTORS.successIndicator) {
      if ((await page.locator(indicator).count()) > 0) return true;
    }
    // 提案完了ページへの遷移を完了URLパターンで判定する。
    // /mypage や /proposals は通常画面でも出るため使わない(誤検知防止)。
    return /\/(complete|thanks|thanksgiving|done)/i.test(page.url());
  }
}
