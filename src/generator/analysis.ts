import { z } from 'zod';

/**
 * Stage 1(案件分析)の出力スキーマ。
 * 依頼文の表面ではなく「相手が本当に求めていること」を構造化し、
 * Stage 2(執筆)が人物像を逆算するための材料にする。
 */
export const jobAnalysisSchema = z.object({
  // クライアントが本当に達成したいこと(依頼の背後にあるビジネス上のゴール)
  clientGoal: z.string(),
  // 悩み・困りごと。依頼文に明示されたものと、行間から推測される不安の両方
  painPoints: z.array(z.string()).default([]),
  // この案件に最適な人物像(スキル面+人柄面)。ここから売り出し方を逆算する
  idealCandidate: z.string(),
  // 応募時に必ず応えるべき指定事項・質問(「〜を記載してください」等)
  mustAddress: z.array(z.string()).default([]),
  // 共感の切り口(冒頭の「この人は分かってくれている」と思わせる一言の材料)
  empathyHooks: z.array(z.string()).default([]),
  // 依頼の規模・依頼文の熱量に応じた適正分量
  recommendedLength: z.enum(['short', 'medium', 'long']).default('medium'),
  // 依頼文から読み取れず、断定せず「推察」に留めるべきこと
  uncertainties: z.array(z.string()).default([]),
});

export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;

/**
 * Claudeの出力テキストからJSONを取り出して検証する。
 * ```json フェンスや前置きが混ざっても、最初の { から最後の } までを拾う。
 * パース・検証に失敗したら null(分析なしでもStage 2は実行可能)。
 */
export function parseJobAnalysis(text: string): JobAnalysis | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const result = jobAnalysisSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
