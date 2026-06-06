import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const LANCERS_MYPAGE = 'https://www.lancers.jp/mypage';
const LOGIN_CHECK_TIMEOUT_MS = 15_000;

export interface BrowserSession {
  readonly context: BrowserContext;
  newPage(): Promise<Page>;
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

  return {
    context,
    newPage: async () => {
      const pages = context.pages();
      return pages[0] && pages[0].url() === 'about:blank' ? pages[0] : context.newPage();
    },
    close: () => context.close(),
  };
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
