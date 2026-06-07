import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { biddingSchema, conditionsSchema } from '../generator/profile.js';

/**
 * sales.yaml(onboard固有の営業設定)の読み込み。
 * knowledge-base に存在しない情報(スコアリング用キーワード・営業条件・入札設定)の正で、
 * profile:sync 時に KB 由来の内容と合成されて profile.yaml に出力される。
 */

export const salesConfigSchema = z.object({
  skills: z.array(z.string()).min(1), // スコアリング用キーワード(scorer.ts 専用)
  categories: z.array(z.string()).min(1),
  ngKeywords: z.array(z.string()).default([]),
  penaltyKeywords: z.array(z.string()).default([]),
  conditions: conditionsSchema,
  bidding: biddingSchema,
});

export type SalesConfig = z.infer<typeof salesConfigSchema>;

export function loadSalesConfig(path: string): SalesConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`sales.yaml が見つかりません: ${path}(営業設定は sales.yaml に分離されました)`);
  }
  const parsed = salesConfigSchema.safeParse(parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`sales.yaml の検証に失敗しました:\n${issues}`);
  }
  return parsed.data;
}
