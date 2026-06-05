import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const workSchema = z.object({
  name: z.string(),
  summary: z.string(),
  outcomes: z.array(z.string()).default([]), // 数値で語れる成果
  stack: z.array(z.string()).default([]),
  url: z.string().optional(),
});

const profileSchema = z.object({
  displayName: z.string(),
  headline: z.string(),
  intro: z.string(), // 自己紹介(提案文の冒頭素材)
  works: z.array(workSchema),
  skills: z.array(z.string()),
  categories: z.array(z.string()), // 対応可能な案件カテゴリ(スコアリング用キーワード)
  ngKeywords: z.array(z.string()).default([]), // 含まれていたら自動スキップ
  conditions: z.object({
    minBudgetYen: z.number().optional(),
    weeklyHours: z.string(), // 例「週20時間」
    responseSla: z.string(), // 例「24時間以内に返信」
    firstDraftDays: z.string(), // 例「着手から4営業日以内に初稿」
  }),
});

export type PortfolioWork = z.infer<typeof workSchema>;
export type Profile = z.infer<typeof profileSchema>;

/** profile.yaml(提案文生成の唯一の正)を読み込んで検証する。 */
export function loadProfile(path: string): Profile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `profile.yaml が見つかりません: ${path}\n(リポジトリ同梱の profile.yaml を確認するか、PROFILE_PATH を設定してください)`,
    );
  }
  const parsed = profileSchema.safeParse(parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`profile.yaml の検証に失敗しました:\n${issues}`);
  }
  return parsed.data;
}
