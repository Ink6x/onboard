/**
 * Lancersへの初回手動ログイン。ヘッド付きブラウザを開くので、表示された画面で
 * 自分でログイン(2FA含む)を完了させてください。セッションは永続プロファイルに
 * 保存され、以降の自動送信で再利用されます。
 *
 * 使い方: npm run lancers:login
 */
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../src/config.js';
import { launchBrowser, isLoggedIn } from '../src/submitter/browser.js';

async function main(): Promise<void> {
  const config = loadConfig();
  // ログインは必ずヘッド付きで開く(headless設定に関わらず)
  const session = await launchBrowser({
    profileDir: config.PLAYWRIGHT_PROFILE_DIR,
    headless: false,
    ...(config.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await session.newPage();

  await page.goto('https://www.lancers.jp/user/login', { waitUntil: 'domcontentloaded' });
  console.log('\n=== Lancersログイン ===');
  console.log('⚠️ 「Googleでログイン」は使わないでください(自動化ブラウザはGoogleに拒否されます)。');
  console.log('   → 画面の「メールアドレス」「パスワード」欄から直接ログインしてください。');
  console.log('   Googleアカウントで登録していてパスワード未設定の場合は、');
  console.log('   先に https://www.lancers.jp/user/reminder でパスワードを設定してください。');
  console.log('\n2FAがあれば完了まで進め、ログインが終わったらこのターミナルで Enter を押してください。');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('');
  rl.close();

  const loggedIn = await isLoggedIn(page);
  if (loggedIn) {
    console.log('✅ ログインを確認しました。セッションを保存しました。');
  } else {
    console.log('⚠️ ログインを確認できませんでした。もう一度 npm run lancers:login を実行してください。');
  }
  await session.close();
  process.exit(loggedIn ? 0 : 1);
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
