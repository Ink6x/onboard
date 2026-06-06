import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { loadProfile } from './generator/profile.js';
import { KeywordScorer } from './generator/scorer.js';
import { ClaudeProposalGenerator } from './generator/claudeGenerator.js';
import { createNotionProjection } from './projection/notion.js';
import { createApprovalBot } from './approval/bot.js';
import { createGmailClient, pollGmail } from './collector/gmailPoller.js';
import { collectFromWeb } from './collector/webCollector.js';
import { LancersSubmitter } from './submitter/submitter.js';
import {
  createApprovalHandlers,
  processNewJobs,
  recoverStuckJobs,
  type PipelineDeps,
} from './pipeline.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  const profile = loadProfile(config.PROFILE_PATH);

  const submitter =
    config.SUBMIT_MODE === 'auto'
      ? new LancersSubmitter({
          profileDir: config.PLAYWRIGHT_PROFILE_DIR,
          headless: config.PLAYWRIGHT_HEADLESS,
          screenshotDir: config.SCREENSHOT_DIR,
          ...(config.PLAYWRIGHT_EXECUTABLE_PATH
            ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
            : {}),
          ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
        })
      : null;

  const deps: PipelineDeps = {
    db,
    config,
    profile,
    scorer: new KeywordScorer(),
    generator: new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY),
    notion: createNotionProjection(config.NOTION_TOKEN, config.NOTION_DATABASE_ID, db),
    submitter,
    sendApprovalCard: async (job, proposal) => approvalBot.sendApprovalCard(job, proposal),
    notify: async (text) => approvalBot.notify(text),
  };

  const approvalBot = createApprovalBot(
    config.TELEGRAM_BOT_TOKEN,
    config.TELEGRAM_CHAT_ID,
    createApprovalHandlers(deps),
  );
  approvalBot.start();

  // 送信途中でクラッシュした案件を復旧する(auto モードのみ意味を持つ)
  await recoverStuckJobs(deps);

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

  // Lancers検索一覧の巡回tick(Gmail tickと同じ排他ロックを共有する)
  const webEnabled = config.WEB_POLL_INTERVAL_MIN > 0;
  async function webTick(): Promise<void> {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const hour = new Date().getHours();
      if (hour >= config.WEB_POLL_HOURS_START && hour < config.WEB_POLL_HOURS_END) {
        const newJobs = await collectFromWeb({ db, config, notify: deps.notify });
        if (newJobs.length > 0) {
          console.log(`[web] 新規案件 ${newJobs.length} 件を登録`);
        }
        await processNewJobs(deps);
      }
    } catch (error) {
      console.error('[web] エラー:', error);
    } finally {
      tickRunning = false;
    }
  }

  // 起動直後に1回実行(10:30にPCが起動していなかった場合の取りこぼし回収)
  await tick();
  if (webEnabled) {
    await webTick();
  }

  // 毎日 POLL_DAILY_AT (HH:MM) に1回実行する。setIntervalだとDST等で時刻がずれるため、
  // 実行のたびに次回までの待ち時間を再計算するsetTimeoutチェーンで管理する。
  let timer: NodeJS.Timeout;
  function msUntilNextRun(): number {
    const [hour, minute] = config.POLL_DAILY_AT.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour ?? 0, minute ?? 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  }
  function scheduleNextTick(): void {
    timer = setTimeout(async () => {
      await tick();
      scheduleNextTick();
    }, msUntilNextRun());
  }
  scheduleNextTick();

  // Web巡回: 間隔±5分のジッターを乗せたsetTimeoutチェーン(アクセスパターンの規則性を崩す)
  let webTimer: NodeJS.Timeout | undefined;
  function nextWebDelayMs(): number {
    const jitterMs = (Math.random() * 10 - 5) * 60_000;
    return Math.max(60_000, config.WEB_POLL_INTERVAL_MIN * 60_000 + jitterMs);
  }
  function scheduleNextWebTick(): void {
    webTimer = setTimeout(async () => {
      await webTick();
      scheduleNextWebTick();
    }, nextWebDelayMs());
  }
  if (webEnabled) {
    scheduleNextWebTick();
  }

  console.log(
    `[onboard] 起動しました (メール収集: 毎日${config.POLL_DAILY_AT}, Web巡回: ${
      webEnabled
        ? `約${config.WEB_POLL_INTERVAL_MIN}分ごと ${config.WEB_POLL_HOURS_START}-${config.WEB_POLL_HOURS_END}時`
        : '無効'
    }, 送信モード: ${config.SUBMIT_MODE})`,
  );

  const shutdown = async (): Promise<void> => {
    clearTimeout(timer);
    if (webTimer) clearTimeout(webTimer);
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
