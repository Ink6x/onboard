import { stringify } from 'yaml';
import { profileSchema, type Profile } from '../generator/profile.js';
import type { SalesConfig } from './salesConfig.js';

/**
 * KB由来の生成結果と sales.yaml(onboard固有設定)を合成して Profile を組み立てる純関数。
 * 出力は必ず既存の profileSchema を通し、loadProfile() が無変更で読める形を保証する。
 */

/** LLM変換+決定論抽出で得られた、profile.yaml の KB 由来部分。 */
export interface GeneratedKbPart {
  readonly displayName: string;
  readonly headline: string;
  readonly intro: string;
  readonly careerSummary: string;
  readonly strengths: readonly string[];
  readonly works: readonly GeneratedWork[];
}

export interface GeneratedWork {
  readonly name: string;
  readonly summary: string;
  readonly experienceNote: string;
  readonly outcomes: readonly string[];
  readonly stack: readonly string[];
  readonly url?: string;
}

export function composeProfile(generated: GeneratedKbPart, sales: SalesConfig): Profile {
  const candidate = {
    displayName: generated.displayName,
    headline: generated.headline,
    intro: generated.intro,
    careerSummary: generated.careerSummary,
    strengths: [...generated.strengths],
    works: generated.works.map((w) => ({
      name: w.name,
      summary: w.summary,
      experienceNote: w.experienceNote,
      outcomes: [...w.outcomes],
      stack: [...w.stack],
      ...(w.url ? { url: w.url } : {}),
    })),
    skills: [...sales.skills],
    categories: [...sales.categories],
    ngKeywords: [...sales.ngKeywords],
    penaltyKeywords: [...sales.penaltyKeywords],
    conditions: { ...sales.conditions },
    bidding: { ...sales.bidding },
  };

  const parsed = profileSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`合成した profile がスキーマ検証に失敗しました:\n${issues}`);
  }
  return parsed.data;
}

/** profile.yaml のファイル内容(自動生成ヘッダつき)を組み立てる。 */
export function renderProfileYaml(profile: Profile, generatedAt: string): string {
  const header = [
    '# ============================================================',
    '# このファイルは自動生成されます: npm run profile:sync',
    '# 手編集禁止。修正は以下を編集して再同期すること:',
    '#   - 人物・実績の内容 → portfolio/knowledge-base/',
    '#   - 営業条件(skills/categories/NG語/conditions/bidding) → sales.yaml',
    `# 生成時刻: ${generatedAt}`,
    '# 同期元のKBハッシュ: .kb-sync.json',
    '# ============================================================',
    '',
  ].join('\n');
  // lineWidth: 0 = 折返し無効(日本語長文が中途半端に折られて差分が読みにくくなるのを防ぐ)
  return header + stringify(profile, { lineWidth: 0 });
}
