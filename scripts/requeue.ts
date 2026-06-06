/**
 * 指定した案件URLをパイプラインの「新着(new)」状態に戻す/新規登録する。
 * 一度スキップ済み・処理済みの案件を、閾値変更後に再評価させるための小道具。
 * 実行後に npm run dev を(再)起動すると、起動時tickで再処理されTelegramに届く。
 *
 * 使い方: npm run requeue -- https://www.lancers.jp/work/detail/<id> "タイトル" "予算"
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { insertJobIfNew, getJob } from '../src/store/jobs.js';
import { fetchJobDetail } from '../src/collector/detailFetcher.js';
import { logEvent } from '../src/store/audit.js';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) throw new Error('使い方: npm run requeue -- <案件URL> ["タイトル"] ["予算"]');
  const title = process.argv[3];
  const budgetText = process.argv[4];

  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);

  const detail = await fetchJobDetail(url);

  const existing = db.prepare('SELECT id FROM jobs WHERE url = ?').get(url) as { id: number } | undefined;
  if (existing) {
    // 既存案件を new に戻し、スコア・送信記録をクリアして再評価対象にする
    db.prepare(
      `UPDATE jobs SET status='new', fit_score=NULL, score_reason=NULL,
         submit_error=NULL, updated_at=datetime('now')
       WHERE id=?`,
    ).run(existing.id);
    if (detail?.description) {
      db.prepare('UPDATE jobs SET description=? WHERE id=?').run(detail.description, existing.id);
    }
    logEvent(db, existing.id, 'requeue:reset_to_new');
    console.log(`既存案件 #${existing.id} を「新着」に戻しました: ${getJob(db, existing.id)?.title}`);
  } else {
    const job = insertJobIfNew(
      db,
      {
        url,
        title: title ?? detail?.description?.split('\n')[0]?.slice(0, 40) ?? 'Lancers案件',
        ...(budgetText ? { budgetText } : {}),
        ...(detail?.description ? { description: detail.description } : {}),
      },
      'gmail',
      null,
    );
    if (job) {
      logEvent(db, job.id, 'requeue:inserted');
      console.log(`新規登録しました #${job.id}: ${job.title}`);
    }
  }

  db.close();
  console.log('\n次に npm run dev を(再)起動してください。起動時に再処理され、Telegramに承認カードが届きます。');
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
