/**
 * Phase 0 検証: ログイン有無で「一覧」「詳細」の取得結果がどれだけ変わるかを定量化する。
 * ハイブリッド(詳細のみログイン)で十分か、一覧もログインが要るか(Phase 3)を判断する材料。
 *
 *   npm run lancers:survey
 *
 * 前提: npm run lancers:login 済み(.playwright-profile にセッションがあること)。
 * このスクリプトは読み取りのみ。応募・送信は一切行わない。
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { launchBrowser, isLoggedIn } from '../src/submitter/browser.js';
import { parseSearchResults } from '../src/collector/searchParser.js';
import { parseJobDetailHtml } from '../src/collector/detailFetcher.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
// 限定公開が混ざりやすい一覧を複数面で走査する(新着順・予算下限なし=ゲート案件も拾う)
const LISTING_URLS = [
  'https://www.lancers.jp/work/search?keyword=AI&open=1&sort=started',
  'https://www.lancers.jp/work/search/design?open=1&sort=started',
  'https://www.lancers.jp/work/search/system?open=1&sort=started',
];

async function fetchAnon(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const session = await launchBrowser({
    profileDir: config.PLAYWRIGHT_PROFILE_DIR,
    headless: true,
    ...(config.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
  });

  try {
    const page = await session.newPage();

    if (!(await isLoggedIn(page))) {
      console.log('❌ 未ログインです。先に npm run lancers:login を実行してください。');
      process.exit(1);
    }
    console.log('✅ ログイン済みセッションを確認\n');

    // === 1. 一覧の差分(複数面を走査して限定公開を集める) ===
    console.log('=== 一覧ページの差分 ===');
    const anonByUrl = new Map<string, string>(); // url -> title
    const authByUrl = new Map<string, string>();
    const gatedUrls = new Set<string>(); // 匿名でタイトルが「限定公開」の案件

    for (const listUrl of LISTING_URLS) {
      const anonHtml = await fetchAnon(listUrl);
      for (const item of anonHtml ? parseSearchResults(anonHtml) : []) {
        anonByUrl.set(item.url, item.title);
        if (item.title.includes('限定公開')) gatedUrls.add(item.url);
      }
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (const item of parseSearchResults(await page.content())) {
        authByUrl.set(item.url, item.title);
      }
      await sleep(1500);
    }

    const onlyInAuth = [...authByUrl.keys()].filter((u) => !anonByUrl.has(u));
    // 同一URLで匿名は「限定公開」だがログインで実タイトルが見える件数
    const titleRevealed = [...gatedUrls].filter(
      (u) => authByUrl.has(u) && !(authByUrl.get(u) ?? '').includes('限定公開'),
    );

    console.log(`  匿名で集めたユニーク案件:    ${anonByUrl.size}件 (うち「限定公開」表示 ${gatedUrls.size}件)`);
    console.log(`  ログインで集めたユニーク案件: ${authByUrl.size}件`);
    console.log(`  ログインのみに出現したURL: ${onlyInAuth.length}件`);
    if (onlyInAuth.length > 0) console.log('   例:', onlyInAuth.slice(0, 5).join(', '));
    console.log(`  匿名「限定公開」→ ログインで実タイトルが見えた: ${titleRevealed.length}/${gatedUrls.size}件`);
    for (const u of titleRevealed.slice(0, 5)) console.log(`   ${u}  →  「${authByUrl.get(u)}」`);

    // === 2. 限定公開の詳細差分(ここが本丸) ===
    console.log('\n=== 限定公開案件の詳細差分(匿名 vs ログイン) ===');
    const targets = gatedUrls.size > 0 ? [...gatedUrls].slice(0, 5) : [...authByUrl.keys()].slice(0, 3);
    if (gatedUrls.size === 0) {
      console.log('  ※今回の走査では「限定公開」案件が見つからず。代わりに通常案件で詳細パーサーの動作を確認。');
    }
    let dumped = false;
    for (const url of targets) {
      const anonHtml = await fetchAnon(url);
      const anon = anonHtml ? parseJobDetailHtml(anonHtml) : null;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1200);
      const authHtml = await page.content();
      const auth = parseJobDetailHtml(authHtml);
      console.log(`  ${url}`);
      console.log(
        `    匿名:    概要${anon?.description ? `${anon.description.length}字` : 'なし'} / 業種${anon?.industry ?? 'なし'}`,
      );
      console.log(
        `    ログイン: 概要${auth.description ? `${auth.description.length}字` : 'なし'} / 業種${auth.industry ?? 'なし'}`,
      );
      // パーサーがログインHTMLで効かない場合に備え、最初の1件のログインHTMLを保存して構造確認できるようにする
      if (!dumped && !auth.description) {
        writeFileSync('./data/survey-logged-in-detail.html', authHtml, 'utf8');
        const hasOverview = authHtml.includes('依頼概要');
        console.log(
          `    ⚠️ ログインでも概要パース不可。HTMLに「依頼概要」の語: ${hasOverview ? 'あり(=パーサー要調整)' : 'なし'}。`,
        );
        console.log('       → ./data/survey-logged-in-detail.html に保存(構造確認用)');
        dumped = true;
      }
      await sleep(1500);
    }

    console.log('\n=== 判断材料 ===');
    console.log('・「ログインのみに出現したURL」が多い → 一覧もログインが必要(Phase 3)');
    console.log('・限定公開でログイン時のみ概要/タイトルが取れる → ハイブリッド(Phase 2)で十分');
    console.log('・ログインでも概要が取れない → 詳細パーサー(parseJobDetailHtml)のログイン版調整が必要');
  } finally {
    await session.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('survey失敗:', error);
  process.exit(1);
});
