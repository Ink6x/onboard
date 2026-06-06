import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { Job, Proposal } from '../types.js';
import {
  buildApprovalCard,
  buildApprovedManualCard,
  buildEditPromptCard,
  buildLightCard,
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

/** 「興味あり」(ライト通知からの提案文生成)の結果。 */
export type InterestOutcome =
  | { readonly kind: 'generated'; readonly job: Job } // 承認カードはパイプライン側から送信済み
  | { readonly kind: 'busy' } // 同一案件の生成が進行中
  | { readonly kind: 'error'; readonly message: string };

/** パイプライン側が実装するコールバック群(botはUIの配線のみを担当)。 */
export interface ApprovalHandlers {
  getJob(jobId: number): Promise<Job | null>;
  onApprove(jobId: number): Promise<ApproveOutcome | null>;
  /** ライト通知の「興味あり」: 提案文を生成して承認待ちへ進める */
  onInterest(jobId: number): Promise<InterestOutcome | null>;
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
  sendLightCard(job: Job): Promise<number>;
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

  // すべてのコールバックは Telegram の制限(約15秒)内に即応答する必要がある。
  // ブラウザ操作など重い処理の前に answerCallbackQuery を返さないと
  // "query is too old" で失敗するため、ヘルパーで最初に必ず応答する。
  const ack = (ctx: { answerCallbackQuery: (opts?: { text?: string }) => Promise<unknown> }, text?: string) =>
    ctx.answerCallbackQuery(text ? { text } : undefined).catch(() => undefined);

  bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
    await ack(ctx, '承認を受け付けました');
    const jobId = Number(ctx.match[1]);
    const progress = await ctx.reply('⏳ 処理中です…(自動送信モードはフォーム入力に30秒ほどかかります)');

    const outcome = await handlers.onApprove(jobId);
    if (!outcome) {
      await ctx.reply('承認できませんでした(処理済み・状態変更済みの可能性)。');
      return;
    }

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
    // 進捗メッセージを掃除(失敗しても無視)
    await ctx.api.deleteMessage(progress.chat.id, progress.message_id).catch(() => undefined);
  });

  bot.callbackQuery(/^confirmSubmit:(\d+)$/, async (ctx) => {
    await ack(ctx, '送信処理を開始しました');
    const jobId = Number(ctx.match[1]);
    const progress = await ctx.reply('🚀 送信処理中です…(数十秒お待ちください)');

    const outcome = await handlers.onConfirmSubmit(jobId);
    if (!outcome) {
      await ctx.reply('送信できませんでした(状態が変わっている可能性)。');
    } else if (outcome.kind === 'submitted') {
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
    await ctx.api.deleteMessage(progress.chat.id, progress.message_id).catch(() => undefined);
  });

  bot.callbackQuery(/^abortSubmit:(\d+)$/, async (ctx) => {
    await ack(ctx, '中止しました');
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onAbortSubmit(jobId);
    if (!job) {
      await ctx.reply('すでに処理済みです。');
      return;
    }
    await ctx.reply('✋ 送信を中止しました(スキップ扱い)。手動で応募する場合は案件URLからどうぞ。', {
      parse_mode: 'HTML',
    });
  });

  bot.callbackQuery(/^interest:(\d+)$/, async (ctx) => {
    await ack(ctx, '提案文の生成を開始しました');
    const jobId = Number(ctx.match[1]);
    const progress = await ctx.reply('✍️ 依頼文を分析して提案文を生成中です…(30秒〜1分ほど)');

    const outcome = await handlers.onInterest(jobId);
    if (!outcome) {
      await ctx.reply('生成できませんでした(処理済み・状態変更済みの可能性)。');
    } else if (outcome.kind === 'busy') {
      await ctx.reply('この案件の提案文は生成中です。完了までお待ちください。');
    } else if (outcome.kind === 'error') {
      await ctx.reply(outcome.message);
    }
    // kind === 'generated' の場合は承認カードがパイプラインから届くため追加返信は不要
    await ctx.api.deleteMessage(progress.chat.id, progress.message_id).catch(() => undefined);
  });

  bot.callbackQuery(/^skip:(\d+)$/, async (ctx) => {
    await ack(ctx, 'スキップしました');
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onSkip(jobId);
    if (!job) {
      await ctx.reply('スキップできませんでした(処理済みの可能性)。');
      return;
    }
    await ctx.reply(buildSkippedCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^edit:(\d+)$/, async (ctx) => {
    await ack(ctx);
    const jobId = Number(ctx.match[1]);
    const job = await handlers.getJob(jobId);
    if (!job) {
      await ctx.reply('案件が見つかりません。');
      return;
    }
    // 編集セッションの衝突検出: 別案件の編集待ち中なら前のセッションを破棄して知らせる
    if (state.awaitingEditJobId !== null && state.awaitingEditJobId !== jobId) {
      await ctx.reply(`⚠️ 案件 #${state.awaitingEditJobId} の編集待ちをキャンセルしました。`);
    }
    state.awaitingEditJobId = jobId;
    await ctx.reply(buildEditPromptCard(job), { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^submitted:(\d+)$/, async (ctx) => {
    await ack(ctx, '記録しました');
    const jobId = Number(ctx.match[1]);
    const job = await handlers.onMarkSubmitted(jobId);
    if (!job) {
      await ctx.reply('記録できませんでした(処理済みの可能性)。');
      return;
    }
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

  // ハンドラ内で投げられた例外でプロセスを落とさない(grammyのデフォルトは再throw)。
  bot.catch((err) => {
    console.error('[telegram] handler error:', err.error);
    // ユーザーにも知らせる(失敗しても無視)
    void bot.api
      .sendMessage(chatId, '⚠️ 内部エラーが発生しました。ログを確認してください。')
      .catch(() => undefined);
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

  async function sendLight(job: Job): Promise<number> {
    const keyboard = new InlineKeyboard()
      .text('✍️ 興味あり', `interest:${job.id}`)
      .text('⏭ スキップ', `skip:${job.id}`);
    const message = await bot.api.sendMessage(chatId, buildLightCard(job), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    return message.message_id;
  }

  return {
    bot,
    sendApprovalCard: (job, proposal) => sendCard(bot, chatId, job, proposal),
    sendLightCard: (job) => sendLight(job),
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
