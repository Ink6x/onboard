import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const LANCERS_MYPAGE = 'https://www.lancers.jp/mypage';
const LOGIN_CHECK_TIMEOUT_MS = 15_000;

export interface BrowserSession {
  readonly context: BrowserContext;
  newPage(): Promise<Page>;
  /**
   * ページを開き fn を実行し、成否に関わらず finally で必ずそのページを閉じる。
   * 「タスク完了=タブを閉じる」を構造的に保証する。
   */
  withPage<T>(fn: (page: Page) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface BrowserOptions {
  readonly profileDir: string;
  readonly headless: boolean;
  /** 実ブラウザの実行ファイル(Brave等)。未指定なら同梱Chromium。 */
  readonly executablePath?: string;
  /** インストール済みチャンネル名('chrome' / 'msedge' 等)。 */
  readonly channel?: string;
}

/**
 * 永続コンテキストでブラウザを起動する。user-data-dirにLancersのログイン
 * セッション(Cookie・2FA記憶)が保存され、再起動後も維持される。
 *
 * 自動化フィンガープリント(navigator.webdriver、--enable-automation)を
 * 抑制し、サイト側の自動化検知に引っかかりにくくする。
 */
export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  mkdirSync(options.profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: options.headless,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
    // 自動化バナー・webdriverフラグを外す
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
  });

  // navigator.webdriver を false に偽装(自動化検知の主要シグナルを消す)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const newPage = async (): Promise<Page> => {
    const pages = context.pages();
    const blank = pages.find((p) => p.url() === 'about:blank');
    if (blank) {
      // about:blank を再利用しつつ、残っている他タブは閉じてアクティブタブを1枚に保つ
      await closeOthers(context, blank);
      return blank;
    }
    // 再利用できる空タブが無ければ、既存タブを全て閉じてから新規タブを開く
    await closeOthers(context, null);
    return context.newPage();
  };

  return {
    context,
    newPage,
    withPage: async <T>(fn: (page: Page) => Promise<T>): Promise<T> => {
      const page = await newPage();
      try {
        return await fn(page);
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    close: async () => {
      // context.close() 任せにせず、各タブを明示的に閉じてから切断する。
      // 永続コンテキスト×実ブラウザ構成ではタブがブラウザ側に残留しやすいため。
      for (const page of context.pages()) {
        await page.close().catch(() => undefined);
      }
      await context.close().catch(() => undefined);
    },
  };
}

/** keep 以外の開いているページを全て閉じる(keep が null なら全ページを閉じる)。 */
async function closeOthers(context: BrowserContext, keep: Page | null): Promise<void> {
  for (const page of context.pages()) {
    if (page === keep) continue;
    await page.close().catch(() => undefined);
  }
}

/**
 * 現在のセッションでLancersにログイン済みかを判定する。
 * マイページにアクセスしてログインフォームへリダイレクトされなければログイン済み。
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(LANCERS_MYPAGE, {
      waitUntil: 'domcontentloaded',
      timeout: LOGIN_CHECK_TIMEOUT_MS,
    });
    const url = page.url();
    // /login や /user/login へ飛ばされたら未ログイン
    return !/\/(login|user\/login|signup|sign_in)/i.test(url);
  } catch {
    return false;
  }
}
