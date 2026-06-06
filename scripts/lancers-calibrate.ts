/**
 * 提案フォームのセレクタ確定用(フォーム発見モード)。
 * 詳細ページ → 「提案する」クリック → 遷移先フォームページの全入力要素を洗い出す。
 * ⚠️ 送信ボタンは押さない(フォームを開いて中身を列挙するだけ)。
 *
 * 使い方: npm run lancers:calibrate -- https://www.lancers.jp/work/detail/<id>
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { loadConfig } from '../src/config.js';
import { launchBrowser, isLoggedIn } from '../src/submitter/browser.js';

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

  console.log(`詳細ページを開きます: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 「提案する」導線を探してクリック(a / button のどちらでも)
  const proposeClicked = await clickPropose(page);
  if (!proposeClicked) {
    console.log('❌ 「提案する」ボタンが見つかりませんでした(募集終了 or ログイン切れの可能性)。');
  } else {
    await page.waitForTimeout(2500);
  }

  console.log(`\n現在のURL: ${page.url()}`);

  // フォームページの全入力要素を列挙する(ブラウザ文脈で実行。DOM型はanyで回避)
  interface FieldInfo {
    tag: string;
    type: string;
    name: string;
    id: string;
    placeholder: string;
    visible: boolean;
  }
  interface ButtonInfo {
    tag: string;
    type: string;
    text: string;
    visible: boolean;
  }
  const fields = (await page.evaluate(`(() => {
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      visible: el.offsetParent !== null,
    });
    const textareas = Array.from(document.querySelectorAll('textarea')).map(describe);
    const inputs = Array.from(document.querySelectorAll('input')).map(describe);
    const buttons = Array.from(document.querySelectorAll('button, input[type=submit]')).map((b) => ({
      tag: b.tagName.toLowerCase(),
      type: b.type || '',
      text: (b.textContent || b.value || '').trim().slice(0, 30),
      visible: b.offsetParent !== null,
    }));
    return { textareas, inputs, buttons };
  })()`)) as { textareas: FieldInfo[]; inputs: FieldInfo[]; buttons: ButtonInfo[] };

  console.log('\n=== textarea ===');
  for (const t of fields.textareas) {
    console.log(`  ${t.visible ? '👁' : '··'} name="${t.name}" id="${t.id}" placeholder="${t.placeholder}"`);
  }
  console.log('\n=== input(text/number系のみ抜粋) ===');
  for (const i of fields.inputs) {
    if (['hidden', 'checkbox', 'radio'].includes(i.type)) continue;
    console.log(`  ${i.visible ? '👁' : '··'} type="${i.type}" name="${i.name}" id="${i.id}" placeholder="${i.placeholder}"`);
  }
  console.log('\n=== button / submit ===');
  for (const b of fields.buttons) {
    if (!b.text) continue;
    console.log(`  ${b.visible ? '👁' : '··'} <${b.tag} type="${b.type}"> "${b.text}"`);
  }

  mkdirSync(config.SCREENSHOT_DIR, { recursive: true });
  const shot = `${config.SCREENSHOT_DIR}/calibrate.png`;
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\nスクショ保存: ${shot}`);

  // 提案フォーム(#ProposalDescriptionを含む<form>)のHTMLを保存する。
  // 計画(タイトル/完了予定日/契約金額)・NDAチェックの正確なセレクタ確定に使う。
  const formHtml = (await page.evaluate(`(() => {
    const ta = document.getElementById('ProposalDescription');
    const form = ta ? ta.closest('form') : document.querySelector('form');
    return form ? form.outerHTML : document.body.innerHTML;
  })()`)) as string;
  mkdirSync('./data', { recursive: true });
  writeFileSync('./data/propose-form.html', formHtml, 'utf8');
  console.log('フォームHTML保存: ./data/propose-form.html');
  console.log('上の一覧・スクショ・このHTMLを開発者(Claude)に渡してください。送信ボタンは押していません。');

  await session.close();
}

/** 「提案する」導線をクリックする。複数候補を順に試す。 */
async function clickPropose(page: Page): Promise<boolean> {
  const candidates = [
    'a:has-text("提案する")',
    'button:has-text("提案する")',
    'a:has-text("案件に提案したい")',
    'a[href*="/work/propose"]',
    'a[href*="/work/proposal"]',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click();
        return true;
      }
    } catch {
      // 次の候補へ
    }
  }
  return false;
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
