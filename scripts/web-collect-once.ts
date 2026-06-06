import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { collectFromWeb, collectFromWebLoggedIn } from '../src/collector/webCollector.js';

/**
 * Web巡回を1tickだけ実行する動作確認ツール。
 * 常駐プロセスを止めずに巡回単体を試したいとき・キーワード調整の確認用。
 *
 *   npm run web:collect                      # 匿名巡回を1tick実行
 *   npm run web:collect -- --logged-in       # ログイン巡回を1tick実行(要 lancers:login)
 *   DATABASE_PATH=./data/smoke.sqlite npm run web:collect   # 使い捨てDBで試す
 *
 * 注意: 本番DBに対して実行すると、新規案件は status=new で登録され、
 * 常駐プロセスの次のtickでスコアリング→承認カード送信まで進む。
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  const loggedIn = process.argv.includes('--logged-in');

  console.log(`[web:collect] DB: ${config.DATABASE_PATH} / モード: ${loggedIn ? 'ログイン' : '匿名'}`);
  const deps = { db, config, notify: async (text: string) => console.log(`[notify] ${text}`) };
  const newJobs = loggedIn ? await collectFromWebLoggedIn(deps) : await collectFromWeb(deps);

  console.log(`[web:collect] 新規登録: ${newJobs.length} 件`);
  for (const job of newJobs) {
    console.log(`  - [${job.category ?? '-'}] ${job.title}`);
    console.log(`    ${job.url} / ${job.budgetText ?? '予算不明'} / ${job.deadline ?? ''}`);
  }
  db.close();
}

main().catch((error) => {
  console.error('[web:collect] 失敗:', error);
  process.exit(1);
});
