/**
 * 実案件での生成品質テスト(DBに書き込まない・Telegramに送らない)。
 * 詳細ページ取得 → スコアリング → 提案文生成 → 自己検査 をコンソールで確認する。
 *
 * 使い方: npx tsx scripts/test-real-job.ts <案件URL> [タイトル]
 */
import { loadConfig } from '../src/config.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import { ClaudeProposalGenerator, validateProposal } from '../src/generator/claudeGenerator.js';
import { fetchJobDetail } from '../src/collector/detailFetcher.js';
import type { Job } from '../src/types.js';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) throw new Error('使い方: npx tsx scripts/test-real-job.ts <案件URL> [タイトル]');

  const config = loadConfig();
  const profile = loadProfile(config.PROFILE_PATH);

  console.log(`1. 詳細ページ取得中: ${url}`);
  const detail = await fetchJobDetail(url);
  console.log(`   依頼概要: ${detail?.description ? `${detail.description.length}字` : '取得失敗'}`);
  console.log(`   業種: ${detail?.industry ?? '不明'} / 既存提案: ${detail?.proposalCount ?? '?'}件以上`);

  const job: Job = {
    id: 0,
    source: 'dummy',
    emailId: null,
    url,
    title: process.argv[3] ?? detail?.description?.split('\n')[0] ?? '(タイトル不明)',
    description: detail?.description ?? null,
    budgetText: null,
    category: null,
    deadline: null,
    status: 'new',
    fitScore: null,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
    proposalCount: detail?.proposalCount ?? null,
    createdAt: '',
    updatedAt: '',
  };

  const score = new KeywordScorer().score(job, profile);
  console.log(`2. スコア: ${score.score} (${score.reason})`);

  console.log('3. 提案文生成中…');
  const generator = new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY);
  const proposal = await generator.generate(job, profile, score);

  console.log(`\n--- 提案文 (${proposal.length}字) ---\n${proposal}\n---`);
  const issues = validateProposal(proposal, job);
  console.log(`自己検査: ${issues.length === 0 ? 'OK' : issues.join(' / ')}`);
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
