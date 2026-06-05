import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { loadProfile } from './generator/profile.js';
import { KeywordScorer } from './generator/scorer.js';
import { ClaudeProposalGenerator } from './generator/claudeGenerator.js';
import { createNotionProjection } from './projection/notion.js';
import { createApprovalBot } from './approval/bot.js';
import { createGmailClient, pollGmail } from './collector/gmailPoller.js';
import { createApprovalHandlers, processNewJobs, type PipelineDeps } from './pipeline.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  const profile = loadProfile(config.PROFILE_PATH);

  const deps: PipelineDeps = {
    db,
    config,
    profile,
    scorer: new KeywordScorer(),
    generator: new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY),
    notion: createNotionProjection(config.NOTION_TOKEN, config.NOTION_DATABASE_ID, db),
    sendApprovalCard: async (job, proposal) => approvalBot.sendApprovalCard(job, proposal),
    notify: async (text) => approvalBot.notify(text),
  };

  const approvalBot = createApprovalBot(
    config.TELEGRAM_BOT_TOKEN,
    config.TELEGRAM_CHAT_ID,
    createApprovalHandlers(deps),
  );
  approvalBot.start();

  const gmail = createGmailClient(config);
  if (!gmail) {
    console.warn('[gmail] OAuth未設定のためポーリングは無効です(npm run gmail:auth で設定)');
  }

  // 排他ロック: 前のtickが終わるまで次のtickを開始しない(二重処理防止)
  let tickRunning = false;
  async function tick(): Promise<void> {
    if (tickRunning) return;
    tickRunning = true;
    try {
      if (gmail) {
        const newJobs = await pollGmail(gmail, db, config.GMAIL_QUERY);
        if (newJobs.length > 0) {
          console.log(`[gmail] 新規案件 ${newJobs.length} 件を登録`);
        }
      }
      await processNewJobs(deps);
    } catch (error) {
      console.error('[tick] エラー:', error);
    } finally {
      tickRunning = false;
    }
  }

  await tick();
  const interval = setInterval(tick, config.POLL_INTERVAL_MINUTES * 60 * 1000);
  console.log(
    `[onboard] 起動しました (ポーリング間隔: ${config.POLL_INTERVAL_MINUTES}分, 送信モード: ${config.SUBMIT_MODE})`,
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(interval);
    await approvalBot.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[onboard] 起動に失敗しました:', error);
  process.exit(1);
});
