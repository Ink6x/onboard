import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const LANCERS_MYPAGE = 'https://www.lancers.jp/mypage';
const LOGIN_CHECK_TIMEOUT_MS = 15_000;

export interface BrowserSession {
  readonly context: BrowserContext;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

/**
 * 永続コンテキストでブラウザを起動する。user-data-dirにLancersのログイン
 * セッション(Cookie・2FA記憶)が保存され、再起動後も維持される。
 */
export async function launchBrowser(
  profileDir: string,
  headless: boolean,
): Promise<BrowserSession> {
  mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
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
