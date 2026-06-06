/**
 * 提案フォームのセレクタ確定用。ログイン済みセッションで指定案件の提案ページを開き、
 * 各セレクタ候補がマッチするか検査してスクショを保存する。
 * ⚠️ 送信ボタンは押さない(フォームを開いて確認するだけ)。
 *
 * 使い方: npm run lancers:calibrate -- https://www.lancers.jp/work/detail/<id>
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { launchBrowser, isLoggedIn } from '../src/submitter/browser.js';
import { LANCERS_SELECTORS, findFirst } from '../src/submitter/selectors.js';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) throw new Error('使い方: npm run lancers:calibrate -- <案件URL>');

  const config = loadConfig();
  const session = await launchBrowser({
    profileDir: config.PLAYWRIGHT_PROFILE_DIR,
    headless: false,
    ...(config.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await session.newPage();

  if (!(await isLoggedIn(page))) {
    console.log('⚠️ 未ログインです。先に npm run lancers:login を実行してください。');
    await session.close();
    process.exit(1);
  }

  const proposeUrl = url.includes('?') ? `${url}&purpose=lancer` : `${url}?purpose=lancer`;
  console.log(`提案ページを開きます: ${proposeUrl}`);
  await page.goto(proposeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const checks: Array<[string, readonly string[]]> = [
    ['提案文textarea', LANCERS_SELECTORS.proposalTextarea],
    ['希望金額input', LANCERS_SELECTORS.amountInput],
    ['納期input', LANCERS_SELECTORS.deliveryInput],
    ['送信ボタン', LANCERS_SELECTORS.submitButton],
  ];

  console.log('\n--- セレクタ検査 ---');
  for (const [label, candidates] of checks) {
    const found = await findFirst(page, candidates, 3000);
    console.log(`${found ? '✅' : '❌'} ${label}: ${found ? 'マッチあり' : 'マッチなし(要修正)'}`);
  }

  mkdirSync(config.SCREENSHOT_DIR, { recursive: true });
  const shot = `${config.SCREENSHOT_DIR}/calibrate.png`;
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\nスクショ保存: ${shot}`);
  console.log('画面とスクショを見て、src/submitter/selectors.ts を必要に応じて修正してください。');
  console.log('(送信ボタンは押していません)');

  await session.close();
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
