/**
 * E2E疎通用: ダミー案件を1件投入してパイプラインを1周回す。
 * Gmail未設定でも 収集(模擬)→スコア→生成→Telegram承認カード→Notion投影 を検証できる。
 *
 * 使い方: npm run e2e:dummy
 * (実行後、Telegramにカードが届く。ボットは src/index.ts 側で常駐している必要がある
 *  ── このスクリプト自体もボットAPIで送信のみ行うため、常駐していなくてもカードは届くが、
 *  ボタン操作には常駐プロセスが必要)
 */
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/store/db.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import { ClaudeProposalGenerator } from '../src/generator/claudeGenerator.js';
import { createNotionProjection } from '../src/projection/notion.js';
import { insertJobIfNew } from '../src/store/jobs.js';
import { logEvent } from '../src/store/audit.js';
import { processNewJobs, type PipelineDeps } from '../src/pipeline.js';
import { buildApprovalCard } from '../src/approval/cards.js';
import { Bot, InlineKeyboard } from 'grammy';

const DUMMY_JOB = {
  url: `https://www.lancers.jp/work/detail/9${Date.now().toString().slice(-6)}`,
  title: '【AI活用】ChatGPT APIを使った社内問い合わせ自動化チャットボットの開発',
  description:
    '社内のよくある問い合わせ(経費精算、勤怠、IT手続き)に自動回答するチャットボットを開発していただきたいです。' +
    'SlackまたはTeams連携を想定。社内ドキュメントを参照して回答する仕組み(RAG)を希望します。' +
    '納期は1.5〜2ヶ月程度、長期的な保守もご相談したいです。',
  budgetText: '300,000円 〜 500,000円',
  category: 'AI開発',
};

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  const profile = loadProfile(config.PROFILE_PATH);
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  const job = insertJobIfNew(db, DUMMY_JOB, 'dummy', null);
  if (!job) {
    console.log('同一URLのダミー案件が既に存在します(冪等性チェックOK)');
    return;
  }
  logEvent(db, job.id, 'job:created', { url: job.url, source: 'dummy' });
  console.log(`1. ダミー案件を登録しました (#${job.id})`);

  const deps: PipelineDeps = {
    db,
    config,
    profile,
    scorer: new KeywordScorer(),
    generator: new ClaudeProposalGenerator(config.ANTHROPIC_API_KEY),
    notion: createNotionProjection(config.NOTION_TOKEN, config.NOTION_DATABASE_ID, db),
    sendApprovalCard: async (approvalJob, proposal) => {
      const keyboard = new InlineKeyboard()
        .text('✅ 承認', `approve:${approvalJob.id}`)
        .text('✏️ 編集', `edit:${approvalJob.id}`)
        .text('⏭ スキップ', `skip:${approvalJob.id}`);
      const message = await bot.api.sendMessage(
        config.TELEGRAM_CHAT_ID,
        buildApprovalCard(approvalJob, proposal),
        { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } },
      );
      console.log('4. Telegramに承認カードを送信しました');
      return message.message_id;
    },
    notify: async (text) => {
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, text, { parse_mode: 'HTML' });
    },
  };

  console.log('2. スコアリング → 3. 提案文生成(Claude API)…');
  await processNewJobs(deps);
  console.log('5. Notion投影まで完了(未設定ならスキップ)');
  console.log('\n✅ E2E疎通完了。ボタン操作を試すには npm run dev で常駐プロセスを起動してください。');
  db.close();
}

main().catch((error) => {
  console.error('❌ E2E疎通に失敗しました:', error);
  process.exit(1);
});
