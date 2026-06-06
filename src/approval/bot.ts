import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { Job, Proposal } from '../types.js';
import {
  buildApprovalCard,
  buildApprovedManualCard,
  buildEditPromptCard,
  buildSkippedCard,
  buildSubmittedCard,
} from './cards.js';

/** 承認操作の結果。送信モードに応じて次にbotが何を表示するかを伝える。 */
export type ApproveOutcome =
  | { readonly kind: 'manual'; readonly job: Job } // 手動送信モード: URLカードを出す
  | { readonly kind: 'filled'; readonly job: Job; readonly screenshotPath: string; readonly caption: string } // 自動入力完了: スクショ+最終確認
  | { readonly kind: 'blocked'; readonly message: string }; // 上限/時間外/要ログイン/エラー

/** 最終送信の結果。 */
export type SubmitOutcome =
  | { readonly kind: 'submitted'; readonly job: Job; readonly screenshotPath: string }
  | { readonly kind: 'error'; readonly message: string; readonly screenshotPath: string | null };

/** パイプライン側が実装するコールバック群(botはUIの配線のみを担当)。 */
export interface ApprovalHandlers {
  getJob(jobId: number): Promise<Job | null>;
  onApprove(jobId: number): Promise<ApproveOutcome | null>;
  onSkip(jobId: number): Promise<Job | null>;
  /** 編集指示を受けて再生成し、新しい提案文を返す */
  onEditInstruction(jobId: number, instruction: string): Promise<{ job: Job; proposal: Proposal } | null>;
  /** 提案文を直接差し替える */
  onReplaceProposal(jobId: number, content: string): Promise<{ job: Job; proposal: Proposal } | null>;
  /** 2段階確認の最終送信(自動送信モード) */
  onConfirmSubmit(jobId: number): Promise<SubmitOutcome | null>;
  /** 入力済みの送信を中止する(自動送信モード) */
  onAbortSubmit(jobId: number): Promise<Job | null>;
  /** 手動送信モードで「送信済み」として記録する */
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

  // 認可: 本人以外からの操作はすべて無視する。
  // ctx.chat はコールバック種別によって null になりうるため ctx.from.id で判定する
  // (1対1チャット前提なので user id === chat id)
  bot.use(async (ctx, next) => {
    if (!ctx.from || String(ctx.from.id) !== chatId) return;
    await next();
  });

  bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const outcome = await handlers.onApprove(jobId);
    if (!outcome) {
      await ctx.answerCallbackQuery({
        text: '承認できませんでした(処理済み・状態変更済みの可能性)',
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: '承認しました' });

    if (outcome.kind === 'manual') {
      const keyboard = new InlineKeyboard().text('🚀 送信済みにする', `submitted:${outcome.job.id}`);
      await ctx.reply(buildApprovedManualCard(outcome.job), {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else if (outcome.kind === 'filled') {
      // 自動入力完了 → スクショ+最終確認(不可逆操作の直前に人間)
      const keyboard = new InlineKeyboard()
        .text('🚀 本当に送信', `confirmSubmit:${outcome.job.id}`)
        .text('✋ 中止', `abortSubmit:${outcome.job.id}`);
      await ctx.replyWithPhoto(new InputFile(outcome.screenshotPath), {
        caption: outcome.caption,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(outcome.message, { parse_mode: 'HTML' });
    }
  });

  bot.callbackQuery(/^confirmSubmit:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: '送信中…' });
    const outcome = await handlers.onConfirmSubmit(jobId);
    if (!outcome) {
      await ctx.reply('送信できませんでした(状態が変わっている可能性)。');
      return;
    }
    if (outcome.kind === 'submitted') {
      await ctx.replyWithPhoto(new InputFile(outcome.screenshotPath), {
        caption: buildSubmittedCard(outcome.job),
        parse_mode: 'HTML',
      });
    } else if (outcome.screenshotPath) {
      await ctx.replyWithPhoto(new InputFile(outcome.screenshotPath), {
        caption: `❌ 送信に失敗しました: ${outcome.message}`,
      });
    } else {
      await ctx.reply(`❌ 送信に失敗しました: ${outcome.message}`);
    }
  });

  bot.callbackQuery(/^abortSubmit:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onAbortSubmit(jobId);
    if (!job) {
      await ctx.answerCallbackQuery({ text: 'すでに処理済みです', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: '中止しました' });
    await ctx.reply('✋ 送信を中止しました(スキップ扱い)。手動で応募する場合は案件URLからどうぞ。', {
      parse_mode: 'HTML',
    });
  });

  bot.callbackQuery(/^skip:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onSkip(jobId);
    if (!job) {
      await ctx.answerCallbackQuery({ text: 'スキップできませんでした(処理済みの可能性)' });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'スキップしました' });
    await ctx.reply(buildSkippedCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^edit:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.getJob(jobId);
    if (!job) {
      await ctx.answerCallbackQuery({ text: '案件が見つかりません' });
      return;
    }
    // 編集セッションの衝突検出: 別案件の編集待ち中なら前のセッションを破棄して知らせる
    if (state.awaitingEditJobId !== null && state.awaitingEditJobId !== jobId) {
      await ctx.reply(`⚠️ 案件 #${state.awaitingEditJobId} の編集待ちをキャンセルしました。`);
    }
    state.awaitingEditJobId = jobId;
    await ctx.answerCallbackQuery();
    await ctx.reply(buildEditPromptCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^submitted:(\d+)$/, async (ctx) => {
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onMarkSubmitted(jobId);
    if (!job) {
      await ctx.answerCallbackQuery({ text: '記録できませんでした(処理済みの可能性)' });
      return;
    }
    await ctx.answerCallbackQuery({ text: '記録しました' });
    await ctx.reply(buildSubmittedCard(job), { parse_mode: 'HTML' });
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
