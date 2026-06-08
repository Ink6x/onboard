import type { Profile } from '../generator/profile.js';
import { composeProfile, renderProfileYaml, type GeneratedWork } from './compose.js';
import { assertDenylistUsable, scanForbiddenTerms } from './denylist.js';
import { buildSyncRecord, type KbSyncRecord } from './hash.js';
import type { KbSnapshot, KbWork } from './kbSchema.js';
import { selectWorks } from './selector.js';
import type { SalesConfig } from './salesConfig.js';
import type { KbTransformer } from './transformer.js';

/**
 * KB→profile.yaml 同期パイプラインの本体。
 * 読込・選別は呼び出し前に済んだ KbSnapshot を受け取り、
 * LLM変換 → 決定論フィールド付与 → 合成 → スキーマ検証 → 禁止語スキャン まで行う。
 * ファイル書き込みは行わない(CLI側が diff 確認・承認の後に書く)。
 */

export interface SyncResult {
  readonly profile: Profile;
  /** 自動生成ヘッダつきの profile.yaml 出力内容 */
  readonly yamlText: string;
  /** .kb-sync.json に書く鮮度記録 */
  readonly record: KbSyncRecord;
  /** 人間に見せる警告(private除外など) */
  readonly warnings: readonly string[];
}

/** links から提案文に添えるURLを1つ選ぶ(repo > demo > detail の優先順)。 */
export function pickWorkUrl(links: Readonly<Record<string, string>>): string | undefined {
  for (const key of ['repo', 'demo', 'detail']) {
    const url = links[key]?.match(/https?:\/\/[^\s（()]+/)?.[0];
    if (url) return url;
  }
  return undefined;
}

export async function syncProfileFromKb(
  kb: KbSnapshot,
  sales: SalesConfig,
  transformer: KbTransformer,
  generatedAt: string,
): Promise<SyncResult> {
  // 禁止語リストの妥当性を先に確認(LLM呼び出し前にfail-closedを判定し、無駄なAPI消費を防ぐ)
  assertDenylistUsable(kb.forbiddenTerms);

  const { selected, excludedPrivate } = selectWorks(kb.works, kb.lancersAllowlist);
  const warnings = excludedPrivate.map(
    (slug) => `disclosure: private のため強制除外しました: ${slug}(掲載したい場合はKB側のdisclosureを見直すこと)`,
  );

  // LLM変換(実績は互いに独立なので並列、経歴叙述も同時に)
  const currentDate = generatedAt.slice(0, 10);
  const [transformedWorks, careerSummary] = await Promise.all([
    Promise.all(selected.map((work) => transformWorkWithContext(transformer, work, kb.outcomesMd))),
    transformer.generateCareerSummary(kb.careerMd, currentDate),
  ]);

  const works: GeneratedWork[] = transformedWorks.map((t, i) => {
    const source = selected[i];
    if (!source) throw new Error('変換結果と選別済み実績の対応が壊れています(内部不整合)');
    const url = pickWorkUrl(source.links);
    return { ...t, stack: source.stack, ...(url ? { url } : {}) };
  });

  const profile = composeProfile(
    {
      displayName: kb.displayName,
      headline: kb.headline,
      intro: kb.intro,
      careerSummary,
      strengths: kb.strengths,
      works,
    },
    sales,
  );

  const yamlText = renderProfileYaml(profile, generatedAt);

  // 最終防壁: 生成物全体(ヘッダ・sales由来部分も含む)を決定論スキャン
  const hits = scanForbiddenTerms(yamlText, kb.forbiddenTerms);
  if (hits.length > 0) {
    throw new Error(
      `生成された profile.yaml に禁止語が含まれるため同期を中止しました: ${hits.join(', ')}\n` +
        '(LLMの匿名化漏れの可能性。再実行するか、KBの該当記述を確認してください)',
    );
  }

  return {
    profile,
    yamlText,
    record: buildSyncRecord(kb.fileContents, generatedAt),
    warnings,
  };
}

/** どの実績の変換で失敗したかをエラーメッセージに残す。 */
async function transformWorkWithContext(transformer: KbTransformer, work: KbWork, outcomesMd: string) {
  try {
    return await transformer.transformWork(work, outcomesMd);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`実績「${work.slug}」のLLM変換に失敗しました: ${message}`);
  }
}
