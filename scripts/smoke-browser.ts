/** Braveが起動し、Lancersのメール/パスワードのログイン欄が存在するか確認(ヘッドレス)。 */
import { loadConfig } from '../src/config.js';
import { launchBrowser } from '../src/submitter/browser.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const session = await launchBrowser({
    profileDir: './.playwright-smoke',
    headless: true,
    ...(config.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await session.newPage();
  await page.goto('https://www.lancers.jp/user/login', { waitUntil: 'domcontentloaded' });

  const ua = (await page.evaluate('navigator.userAgent')) as string;
  const webdriver = (await page.evaluate('navigator.webdriver')) as boolean;
  const emailField = await page.locator('input[type="email"], input[name*="email"], input[name="data[User][email]"]').count();
  const passField = await page.locator('input[type="password"]').count();
  const googleBtn = await page.locator('text=Google').count();

  console.log('UA:', ua);
  console.log('navigator.webdriver:', webdriver, '(falseが望ましい)');
  console.log('メール入力欄:', emailField, '個');
  console.log('パスワード入力欄:', passField, '個');
  console.log('Google系ボタン:', googleBtn, '個(これは使わない)');
  await session.close();
}

main().catch((e) => {
  console.error('失敗:', e instanceof Error ? e.message : e);
  process.exit(1);
});
