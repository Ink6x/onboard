import { z } from 'zod';
import type { Job } from '../types.js';

/**
 * 手動提案文生成CLI(scripts/propose.ts)の入力パース層。
 * 引数・ファイル内容はすべて外部由来のため、ここで検証してから生成に渡す。
 */

/** 入力元: URL自動取得 / テキスト直指定 / ファイル / inboxディレクトリ一括 のいずれか1つ */
export type ProposeSource =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inbox'; readonly dir: string };

export interface ProposeArgs {
  readonly source: ProposeSource;
  readonly title?: string | undefined;
  readonly budget?: string | undefined;
  readonly category?: string | undefined;
  readonly deadline?: string | undefined;
  readonly proposalCount?: number | undefined;
  /** 単発モード: 保存先ファイル / inboxモード: 保存先ディレクトリ */
  readonly out?: string | undefined;
}

export const USAGE = `使い方: npm run propose -- <入力元> [オプション]
入力元(いずれか1つ):
  --url=<案件URL>        Lancers詳細ページから依頼概要を自動取得
  --text=<案件本文>      テキスト直指定(--title 必須)
  --file=<パス>          ファイル投入(先頭行=タイトル、残り=本文)
  --inbox=<ディレクトリ> *.md/*.txt を一括生成(処理済みは done/ へ移動)
オプション:
  --title=<タイトル> --budget=<予算> --category=<カテゴリ>
  --deadline=<締切> --proposal-count=<既存提案数> --out=<保存先>`;

const KNOWN_FLAGS = [
  'url',
  'text',
  'file',
  'inbox',
  'title',
  'budget',
  'category',
  'deadline',
  'proposal-count',
  'out',
] as const;

const rawArgsSchema = z.object({
  url: z
    .string()
    .url('--url は有効なURLで指定してください')
    .startsWith('https://', '--url は https:// で始まる必要があります')
    .optional(),
  text: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  inbox: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  budget: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  deadline: z.string().min(1).optional(),
  'proposal-count': z.coerce
    .number({ invalid_type_error: '--proposal-count は数値で指定してください' })
    .int('--proposal-count は整数で指定してください')
    .nonnegative('--proposal-count は0以上で指定してください')
    .optional(),
  out: z.string().min(1).optional(),
});

/** `--key=value` 形式の引数を検証付きでパースする。不正な入力は使い方付きのErrorを投げる。 */
export function parseProposeArgs(argv: readonly string[]): ProposeArgs {
  const entries: Record<string, string> = {};
  for (const arg of argv) {
    // sフラグ必須: --text= には改行を含む案件本文が渡りうる(シェルのクォート文字列経由)
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (!match || !(KNOWN_FLAGS as readonly string[]).includes(match[1] ?? '')) {
      throw new Error(`不明な引数です: ${arg.split('=')[0]}\n\n${USAGE}`);
    }
    entries[match[1] as string] = match[2] ?? '';
  }

  const parsed = rawArgsSchema.safeParse(entries);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`引数の検証に失敗しました:\n${issues}\n\n${USAGE}`);
  }
  const raw = parsed.data;

  const sources: ProposeSource[] = [
    ...(raw.url ? [{ kind: 'url', url: raw.url } as const] : []),
    ...(raw.text ? [{ kind: 'text', text: raw.text } as const] : []),
    ...(raw.file ? [{ kind: 'file', path: raw.file } as const] : []),
    ...(raw.inbox ? [{ kind: 'inbox', dir: raw.inbox } as const] : []),
  ];
  if (sources.length === 0) {
    throw new Error(`入力元(--url / --text / --file / --inbox)を指定してください。\n\n${USAGE}`);
  }
  if (sources.length > 1) {
    throw new Error(`入力元はいずれか1つだけ指定してください。\n\n${USAGE}`);
  }
  const source = sources[0] as ProposeSource;

  if (source.kind === 'text' && !raw.title) {
    throw new Error(`--text 指定時は --title が必須です。\n\n${USAGE}`);
  }

  return {
    source,
    title: raw.title,
    budget: raw.budget,
    category: raw.category,
    deadline: raw.deadline,
    proposalCount: raw['proposal-count'],
    out: raw.out,
  };
}

export interface ParsedJobFile {
  readonly title: string;
  readonly description: string | null;
}

/** 案件ファイル(.md/.txt)のパース: 先頭の非空行をタイトル、残り全体を本文として扱う。 */
export function parseJobFile(content: string): ParsedJobFile {
  const lines = content.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex === -1) {
    throw new Error('ファイルが空です(先頭行にタイトル、残りに案件本文を書いてください)');
  }
  const title = (lines[titleIndex] as string).trim();
  const description = lines
    .slice(titleIndex + 1)
    .join('\n')
    .trim();
  return { title, description: description.length > 0 ? description : null };
}

export interface JobInput {
  readonly url: string;
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly budgetText?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly deadline?: string | null | undefined;
  readonly proposalCount?: number | null | undefined;
}

/**
 * 生成に必要なフィールドだけを持つJobを組み立てる。
 * DB・Telegram・Notion関連フィールドは生成では未使用のためダミー値で埋める
 * (scripts/test-real-job.ts と同じ方針)。
 */
export function buildJob(input: JobInput): Job {
  return {
    id: 0,
    source: 'dummy',
    emailId: null,
    url: input.url,
    title: input.title,
    description: input.description ?? null,
    budgetText: input.budgetText ?? null,
    category: input.category ?? null,
    deadline: input.deadline ?? null,
    status: 'new',
    fitScore: null,
    scoreReason: null,
    notionPageId: null,
    telegramMessageId: null,
    submittedAt: null,
    proposalCount: input.proposalCount ?? null,
    bidAmountYen: null,
    bidDeliveryDays: null,
    submitError: null,
    screenshotPath: null,
    createdAt: '',
    updatedAt: '',
  };
}
