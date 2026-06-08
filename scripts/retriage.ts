/**
 * 承認待ちバックログの一括再トリアージ。
 * スコアラー/閾値の変更後に、pending_approval に溜まった案件を新スコアで再評価し、
 * LIGHT_NOTIFY_SCORE 未満になったものを skipped_low_score へ降格する(ノイズ掃除)。
 *
 * - 降格はDB直接更新(状態機械は通さない。requeue.ts と同じメンテナンス用の特例)
 * - Telegram上の古いカードはそのまま残るが、降格後にボタンを押しても
 *   状態検証(pending_approval以外は拒否)で安全に弾かれる
 * - LIGHT_NOTIFY_SCORE 以上は提案文生成済みのため pending_approval のまま残す
 *
 * 使い方:
 *   npm run retriage          # ドライラン(何が起きるか表示するだけ)
 *   npm run retriage -- --apply  # 実際に降格を書き込む(常駐プロセス停止中に実行すること)
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { listJobsByStatus, updateJobScore } from '../src/store/jobs.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import { logEvent } from '../src/store/audit.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const config = loadConfig();
  const profile = loadProfile(config.PROFILE_PATH);
  const scorer = new KeywordScorer();
  const db = openDb(config.DATABASE_PATH);

  const pending = listJobsByStatus(db, 'pending_approval');
  console.log(`pending_approval: ${pending.length}件を再評価します(閾値: 降格 < ${config.LIGHT_NOTIFY_SCORE})\n`);

  const results = pending.map((job) => {
    const score = scorer.score(job, profile);
    return { job, score };
  });
  const demote = results.filter((r) => r.score.score < config.LIGHT_NOTIFY_SCORE);
  const keep = results.filter((r) => r.score.score >= config.LIGHT_NOTIFY_SCORE);

  console.log(`--- 降格対象(→ skipped_low_score): ${demote.length}件 ---`);
  for (const { job, score } of demote) {
    console.log(`#${String(job.id).padStart(3)} 旧${String(job.fitScore ?? '-').padStart(3)} → 新${String(score.score).padStart(3)} | ${job.title.slice(0, 50)}`);
  }
  console.log(`\n--- 承認待ちのまま残す: ${keep.length}件 ---`);
  for (const { job, score } of keep) {
    console.log(`#${String(job.id).padStart(3)} 旧${String(job.fitScore ?? '-').padStart(3)} → 新${String(score.score).padStart(3)} | ${job.title.slice(0, 50)}`);
  }

  if (!apply) {
    console.log('\nドライランです。書き込むには --apply を付けて実行してください(常駐プロセスは停止しておくこと)。');
    db.close();
    return;
  }

  // スコア更新と降格を1トランザクションにまとめる(途中失敗で不整合な状態を残さない)
  const applyAll = db.transaction(() => {
    for (const { job, score } of demote) {
      updateJobScore(db, job.id, score.score, score.reason);
      db.prepare(`UPDATE jobs SET status='skipped_low_score', updated_at=datetime('now') WHERE id=?`).run(job.id);
      logEvent(db, job.id, 'retriage:demoted', { from: 'pending_approval', score: score.score });
    }
    // 残す案件もスコアと判定理由は最新化しておく(Notion・次回判断の材料)
    for (const { job, score } of keep) {
      updateJobScore(db, job.id, score.score, score.reason);
      logEvent(db, job.id, 'retriage:rescored', { score: score.score });
    }
  });
  applyAll();
  console.log(`\n✅ ${demote.length}件を降格、${keep.length}件のスコアを更新しました。`);
  console.log('Notionへの反映は次回の状態遷移時に行われます(即時反映が必要なら npm run notion:migrate)。');
  db.close();
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
