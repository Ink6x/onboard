/** 提案文生成パスの単体テスト: DB内の既存ダミー案件で生成だけを実行して出力を確認する。 */
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import { ClaudeProposalGenerator, validateProposal } from '../src/generator/claudeGenerator.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  const profile = loadProfile(config.PROFILE_PATH);

  const row = db
    .prepare(`SELECT id FROM jobs WHERE source = 'dummy' ORDER BY id DESC LIMIT 1`)
    .get() as { id: number } | undefined;
  if (!row) throw new Error('ダミー案件がDBにありません(npm run e2e:dummy を先に実行)');

  const { getJob } = await import('../src/store/jobs.js');
  const job = getJob(db, row.id);
  if (!job) throw new Error('案件の取得に失敗');

  console.log(`対象: #${job.id} ${job.title}`);
  const scorer = new KeywordScorer();
  const score = scorer.score(job, profile);
  console.log(`スコア: ${score.score} (${score.reason})`);

  const generator = new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY);
  const proposal = await generator.generate(job, profile, score);

  console.log(`\n--- 生成結果 (${proposal.length}字) ---`);
  console.log(proposal);
  console.log('--- 自己検査 ---');
  const issues = validateProposal(proposal, job);
  console.log(issues.length === 0 ? 'OK' : issues.join(' / '));
  db.close();
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
