import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { KbWork } from './kbSchema.js';
import {
  buildCareerSummaryUserPrompt,
  buildWorkUserPrompt,
  CAREER_SUMMARY_SYSTEM,
  WORK_TRANSFORM_SYSTEM,
} from './prompts.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 2; // 初回 + 出力形式NG時の再試行1回

/** LLM呼び出しの最小インターフェース(テストではスタブを注入する)。 */
export interface MessageCreator {
  create(params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: { role: 'user'; content: string }[];
  }): Promise<{ content: { type: string; text?: string }[] }>;
}

/** LLMが変換した実績1件分(stack/urlは決定論で別途付与するため含まない)。 */
const transformedWorkSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  experienceNote: z.string().min(1),
  outcomes: z.array(z.string()).default([]),
});

export type TransformedWork = z.infer<typeof transformedWorkSchema>;

/** KB→営業素材のLLM変換器。匿名化の最終保証は呼び出し側の禁止語スキャンが担う。 */
export class KbTransformer {
  constructor(private readonly messages: MessageCreator) {}

  static fromApiKey(apiKey: string): KbTransformer {
    // timeout: API無応答でプロセスが永久に待ち続けるのを防ぐ(SDKがリトライも管理する)
    const client = new Anthropic({ apiKey, timeout: 120_000 });
    return new KbTransformer(client.messages as unknown as MessageCreator);
  }

  /** works/*.md 1件 → profile.yaml works 1エントリのLLM変換部分。 */
  async transformWork(work: KbWork, outcomesMd: string): Promise<TransformedWork> {
    const userPrompt = buildWorkUserPrompt(work, outcomesMd);
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const text = await this.callLlm(WORK_TRANSFORM_SYSTEM, userPrompt + (lastError ? `\n\n前回の出力は不正でした(${lastError})。形式を守って出力し直してください。` : ''), 1500);
      const parsed = transformedWorkSchema.safeParse(parseJsonObject(text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues[0]?.message ?? 'JSONとして解釈できない';
    }
    throw new Error(`実績「${work.slug}」の変換が${MAX_ATTEMPTS}回とも不正な形式でした: ${lastError}`);
  }

  /** career.md → 匿名化された経歴叙述(careerSummary)。 */
  async generateCareerSummary(careerMd: string, currentDate: string): Promise<string> {
    const text = await this.callLlm(
      CAREER_SUMMARY_SYSTEM,
      buildCareerSummaryUserPrompt(careerMd, currentDate),
      1000,
    );
    const summary = text.trim();
    if (summary.length < 50) {
      throw new Error(`careerSummaryの生成結果が短すぎます(${summary.length}字): ${summary}`);
    }
    return summary;
  }

  private async callLlm(system: string, content: string, maxTokens: number): Promise<string> {
    const response = await this.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text' || !block.text) {
      throw new Error('LLMから予期しない応答形式が返されました');
    }
    return block.text;
  }
}

/**
 * コードフェンスや前置きが混ざっていても最初のJSONオブジェクトを取り出す。
 * 貪欲マッチ(最初の { から最後の } まで)だと複数オブジェクト混在時に壊れるため、
 * 括弧の深さと文字列リテラルを追跡してバランスの取れた最初のオブジェクトを切り出す。
 */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
