import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),
  NOTION_TOKEN: z.string().default(''),
  NOTION_DATABASE_ID: z.string().default(''),
  NOTION_PARENT_PAGE_ID: z.string().default(''),
  GMAIL_CLIENT_ID: z.string().default(''),
  GMAIL_CLIENT_SECRET: z.string().default(''),
  GMAIL_REFRESH_TOKEN: z.string().default(''),
  GMAIL_QUERY: z.string().default('from:lancers.jp newer_than:7d'),
  // メール収集の実行時刻 (HH:MM)。Lancersの案件紹介メールは毎日10時台に1通のみ届くため、
  // 間隔ポーリングではなく毎日この時刻に1回だけ実行する。
  POLL_DAILY_AT: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'POLL_DAILY_AT must be HH:MM (e.g. 10:30)')
    .default('10:30'),
  // === Lancers検索一覧の直接巡回(Web収集) ===
  // 巡回間隔(分)。0で無効。実際の発火時刻には±5分のジッターが乗る。
  WEB_POLL_INTERVAL_MIN: z.coerce.number().int().min(0).default(60),
  // 巡回を行う時間帯(この範囲外のtickはスキップ)
  WEB_POLL_HOURS_START: z.coerce.number().int().min(0).max(23).default(9),
  WEB_POLL_HOURS_END: z.coerce.number().int().min(1).max(24).default(22),
  // キーワード検索のローテーションリスト(カンマ区切り)
  WEB_SEARCH_KEYWORDS: z
    .string()
    .default('AI,生成AI,ChatGPT,LLM,チャットボット,自動化,業務効率化,RAG,スクレイピング,GAS,n8n,Next.js'),
  // カテゴリ検索のローテーションリスト(/work/search/ 以下のパス、カンマ区切り)
  WEB_SEARCH_CATEGORIES: z
    .string()
    .default('system/ai,system/ai_automation,system/chatbot,system/chatgpt,system/tool,system/websystem,web'),
  // 検索の予算下限(円)。0で無効。エージェント求人の混入を減らす効果もある。
  WEB_SEARCH_BUDGET_FROM: z.coerce.number().int().min(0).default(10000),
  // 1tickで巡回する検索URLの最大数(リクエスト予算。リストを増やしても頻度は一定)
  WEB_TARGETS_PER_TICK: z.coerce.number().int().min(1).default(4),
  MAX_APPLICATIONS_PER_DAY: z.coerce.number().int().positive().default(3),
  MIN_FIT_SCORE: z.coerce.number().int().min(0).max(100).default(60),
  SUBMIT_MODE: z.enum(['manual', 'auto']).default('manual'),
  PLAYWRIGHT_PROFILE_DIR: z.string().default('./.playwright-profile'),
  PLAYWRIGHT_HEADLESS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // 実ブラウザの実行ファイル(Brave等)。指定すると同梱Chromiumの代わりに使う。
  PLAYWRIGHT_EXECUTABLE_PATH: z.string().default(''),
  // または 'chrome' / 'msedge' などインストール済みチャンネル名
  PLAYWRIGHT_CHANNEL: z.string().default(''),
  SCREENSHOT_DIR: z.string().default('./data/screenshots'),
  SUBMIT_HOURS_START: z.coerce.number().int().min(0).max(23).default(9),
  SUBMIT_HOURS_END: z.coerce.number().int().min(1).max(24).default(22),
  SUBMIT_DELAY_MIN_SEC: z.coerce.number().int().min(0).default(20),
  SUBMIT_DELAY_MAX_SEC: z.coerce.number().int().min(0).default(90),
  DATABASE_PATH: z.string().default('./data/onboard.sqlite'),
  PROFILE_PATH: z.string().default('./profile.yaml'),
});

export type Config = z.infer<typeof envSchema>;

/** 起動時に環境変数を検証して返す。不足があれば明確なエラーで落とす。 */
export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`環境変数の検証に失敗しました:\n${issues}\n(.env.example を参照してください)`);
  }
  return parsed.data;
}
