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
  POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
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
