/**
 * 実フォーム入力テスト(送信は絶対にしない)。
 * 本番と同じ送信エンジン(LancersSubmitter)の fill ステージを、指定した
 * 募集中案件URLに対して実行し、フォームに各値が入るかをスクショで確認する。
 * DB・Telegram・閾値には一切依存しない。
 *
 * 使い方: npm run lancers:testfill -- https://www.lancers.jp/work/detail/<id>
 */
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import { ClaudeProposalGenerator } from '../src/generator/claudeGenerator.js';
import { fetchJobDetail } from '../src/collector/detailFetcher.js';
import { computeBidValues } from '../src/submitter/bidValues.js';
import { LancersSubmitter } from '../src/submitter/submitter.js';
import type { Job } from '../src/types.js';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) throw new Error('使い方: npm run lancers:testfill -- <募集中の案件URL>');

  const config = loadConfig();
  const profile = loadProfile(config.PROFILE_PATH);

  console.log(`1. 詳細取得: ${url}`);
  const detail = await fetchJobDetail(url);
  console.log(`   依頼概要: ${detail?.description ? `${detail.description.length}字` : '取得失敗'}`);

  const job: Job = {
    id: 0,
    source: 'dummy',
    emailId: null,
    url,
    title: process.argv[3] ?? '(テスト案件)',
    description: detail?.description ?? null,
    budgetText: process.argv[4] ?? null,
    category: null,
    deadline: null,
    status: 'approved',
    fitScore: null,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
    proposalCount: detail?.proposalCount ?? null,
    bidAmountYen: null,
    bidDeliveryDays: null,
    submitError: null,
    screenshotPath: null,
    createdAt: '',
    updatedAt: '',
  };

  const score = new KeywordScorer().score(job, profile);
  const bid = computeBidValues(job, profile);
  console.log(`2. 提案文生成中(スコア${score.score})…`);
  const proposal = await new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY).generate(job, profile, score);
  console.log(`   提案文 ${proposal.length}字 / 希望金額 ${bid.amountYen}円(${bid.rationale})/ 納期 ${bid.deliveryDays}日`);

  // 本番と同じ送信エンジン。fill ステージは入力+スクショまでで、送信ボタンは押さない。
  const submitter = new LancersSubmitter({
    profileDir: config.PLAYWRIGHT_PROFILE_DIR,
    headless: false, // 目視できるよう必ずヘッド付き
    screenshotDir: config.SCREENSHOT_DIR,
    ...(config.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
  });

  console.log('3. フォーム入力中(送信はしません)…');
  const result = await submitter.run(job, bid, proposal, 'fill');

  if (result.status === 'filled') {
    console.log(`\n✅ 入力完了。送信はしていません。`);
    console.log(`   スクショ: ${result.screenshotPath}`);
    console.log('   このスクショで 提案文/契約金額/完了予定日/NDAチェック が入っているか確認してください。');
  } else if (result.status === 'needs_login') {
    console.log('\n🔑 未ログインです。npm run lancers:login を実行してください。');
  } else if (result.status === 'error') {
    console.log(`\n❌ 失敗: ${result.message}`);
    if (result.screenshotPath) console.log(`   スクショ: ${result.screenshotPath}`);
  } else {
    console.log(`\n想定外の結果: ${result.status}(fillステージでは送信されないはずです)`);
  }
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
