import { Bot, InlineKeyboard } from 'grammy';
import type { Job, Proposal } from '../types.js';
import {
  buildApprovalCard,
  buildApprovedManualCard,
  buildEditPromptCard,
  buildSkippedCard,
  buildSubmittedCard,
} from './cards.js';

/** パイプライン側が実装するコールバック群(botはUIの配線のみを担当)。 */
export interface ApprovalHandlers {
  getJob(jobId: number): Promise<Job | null>;
  onApprove(jobId: number): Promise<Job | null>;
  onSkip(jobId: number): Promise<Job | null>;
  /** 編集指示を受けて再生成し、新しい提案文を返す */
  onEditInstruction(jobId: number, instruction: string): Promise<{ job: Job; proposal: Proposal } | null>;
  /** 提案文を直接差し替える */
  onReplaceProposal(jobId: number, content: string): Promise<{ job: Job; proposal: Proposal } | null>;
  onMarkSubmitted(jobId: number): Promise<Job | null>;
}

export interface ApprovalBot {
  readonly bot: Bot;
  sendApprovalCard(job: Job, proposal: Proposal): Promise<number>;
  notify(text: string): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

/** 編集対象の案件ID(単一ユーザー前提のセッション状態)。 */
interface ChatState {
  awaitingEditJobId: number | null;
}

export function createApprovalBot(
  token: string,
  chatId: string,
  handlers: ApprovalHandlers,
): ApprovalBot {
  const bot = new Bot(token);
  const state: ChatState = { awaitingEditJobId: null };

  // 認可: 自分のチャット以外からの操作はすべて無視する
  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== chatId) return;
    await next();
  });

  bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onApprove(jobId);
    await ctx.answerCallbackQuery({ text: '承認しました' });
    if (job) {
      const keyboard = new InlineKeyboard().text('🚀 送信済みにする', `submitted:${job.id}`);
      await ctx.reply(buildApprovedManualCard(job), { parse_mode: 'HTML', reply_markup: keyboard });
    }
  });

  bot.callbackQuery(/^skip:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onSkip(jobId);
    await ctx.answerCallbackQuery({ text: 'スキップしました' });
    if (job) await ctx.reply(buildSkippedCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^edit:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.getJob(jobId);
    if (!job) {
      await ctx.answerCallbackQuery({ text: '案件が見つかりません' });
      return;
    }
    state.awaitingEditJobId = jobId;
    await ctx.answerCallbackQuery();
    await ctx.reply(buildEditPromptCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^submitted:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onMarkSubmitted(jobId);
    await ctx.answerCallbackQuery({ text: '記録しました' });
    if (job) await ctx.reply(buildSubmittedCard(job), { parse_mode: 'HTML' });
  });

  // 編集モード中のテキスト = 修正指示 or 「差し替え:」で始まる直接差し替え
  bot.on('message:text', async (ctx) => {
    const jobId = state.awaitingEditJobId;
    if (jobId === null) return;
    state.awaitingEditJobId = null;

    const text = ctx.message.text.trim();
    await ctx.reply('再生成中です…');

    const result = text.startsWith('差し替え:')
      ? await handlers.onReplaceProposal(jobId, text.slice('差し替え:'.length).trim())
      : await handlers.onEditInstruction(jobId, text);

    if (!result) {
      await ctx.reply('対象の案件が見つかりませんでした。');
      return;
    }
    await sendCard(bot, chatId, result.job, result.proposal);
  });

  async function sendCard(botInstance: Bot, chat: string, job: Job, proposal: Proposal): Promise<number> {
    const keyboard = new InlineKeyboard()
      .text('✅ 承認', `approve:${job.id}`)
      .text('✏️ 編集', `edit:${job.id}`)
      .text('⏭ スキップ', `skip:${job.id}`);
    const message = await botInstance.api.sendMessage(chat, buildApprovalCard(job, proposal), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    return message.message_id;
  }

  return {
    bot,
    sendApprovalCard: (job, proposal) => sendCard(bot, chatId, job, proposal),
    notify: async (text) => {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
    },
    start: () => {
      // long polling(常駐プロセス前提。webhookは不要)
      void bot.start({ onStart: () => console.log('[telegram] bot started') });
    },
    stop: () => bot.stop(),
  };
}
