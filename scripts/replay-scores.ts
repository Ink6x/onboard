/**
 * スコアラー較正用リプレイ: DB内の全案件に現行スコアラーを適用し直し、
 * 旧スコアとの分布比較・ティア別の案件一覧を表示する(DBは変更しない)。
 *
 * 使い方: npm run scores:replay
 * ティア境界を試す: npm run scores:replay -- --full 70 --light 40
 */
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import type { Job } from '../src/types.js';

interface JobRowLite {
  id: number;
  url: string;
  title: string;
  description: string | null;
  budget_text: string | null;
  category: string | null;
  status: string;
  fit_score: number | null;
}

/** リプレイ用に最小限のJobを組み立てる(スコアラーが参照する項目のみ実値)。 */
function toJob(row: JobRowLite): Job {
  return {
    id: row.id,
    source: 'web',
    emailId: null,
    url: row.url,
    title: row.title,
    description: row.description,
    budgetText: row.budget_text,
    category: row.category,
    deadline: null,
    status: 'new',
    fitScore: row.fit_score,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
    proposalCount: null,
    bidAmountYen: null,
    bidDeliveryDays: null,
    submitError: null,
    screenshotPath: null,
    createdAt: '',
    updatedAt: '',
  };
}

function parseTierArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const value = raw !== undefined ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`--${name} は0〜100の整数で指定してください(指定値: ${raw})`);
  }
  return value;
}

function bucketOf(score: number): string {
  if (score >= 80) return '80-100';
  if (score >= 60) return '60-79';
  if (score >= 40) return '40-59';
  if (score >= 20) return '20-39';
  return '0-19';
}

function main(): void {
  const fullAuto = parseTierArg('full', 70);
  const lightNotify = parseTierArg('light', 40);
  if (lightNotify > fullAuto) {
    throw new Error(`--light (${lightNotify}) は --full (${fullAuto}) 以下にしてください`);
  }

  const config = loadConfig();
  const profile = loadProfile(config.PROFILE_PATH);
  const scorer = new KeywordScorer();
  const db = new Database(config.DATABASE_PATH, { readonly: true });

  const rows = db
    .prepare(
      `SELECT id, url, title, description, budget_text, category, status, fit_score
       FROM jobs WHERE source != 'dummy' ORDER BY id ASC`,
    )
    .all() as JobRowLite[];

  const results = rows.map((row) => {
    const { score, reason } = scorer.score(toJob(row), profile);
    return { row, score, reason };
  });

  // 新旧スコア分布
  const buckets = ['80-100', '60-79', '40-59', '20-39', '0-19'];
  console.log('=== スコア分布(旧 → 新) ===');
  for (const bucket of buckets) {
    const oldCount = results.filter((r) => r.row.fit_score !== null && bucketOf(r.row.fit_score) === bucket).length;
    const newCount = results.filter((r) => bucketOf(r.score) === bucket).length;
    console.log(`${bucket.padStart(6)}: ${String(oldCount).padStart(3)} → ${String(newCount).padStart(3)}`);
  }

  // ティア別件数
  const full = results.filter((r) => r.score >= fullAuto);
  const light = results.filter((r) => r.score >= lightNotify && r.score < fullAuto);
  const skip = results.filter((r) => r.score < lightNotify);
  console.log(`\n=== ティア別(--full ${fullAuto} / --light ${lightNotify}) ===`);
  console.log(`フル自動(生成+承認カード): ${full.length}件`);
  console.log(`ライト通知(ボタン押下で生成): ${light.length}件`);
  console.log(`サイレントスキップ: ${skip.length}件`);

  const show = (label: string, list: typeof results): void => {
    console.log(`\n--- ${label} ---`);
    for (const r of list) {
      const oldScore = r.row.fit_score === null ? ' -' : String(r.row.fit_score).padStart(3);
      console.log(`#${String(r.row.id).padStart(3)} 旧${oldScore} → 新${String(r.score).padStart(3)} | ${r.row.title.slice(0, 50)}`);
      console.log(`      ${r.reason}`);
    }
  };

  show('フル自動ティア', full);
  show('ライト通知ティア', light);

  // 退行チェック用: 旧スコアで通知圏内(>=60)だったのに新スコアでスキップ落ちした案件
  const demoted = results.filter(
    (r) => r.row.fit_score !== null && r.row.fit_score >= 60 && r.score < lightNotify,
  );
  if (demoted.length > 0) {
    show('⚠️ 旧60以上 → 新スキップ落ち(要目視確認)', demoted);
  } else {
    console.log('\n旧60以上からスキップ落ちした案件はありません。');
  }

  db.close();
}

main();
