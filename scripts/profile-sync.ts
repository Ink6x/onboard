/**
 * KB→profile.yaml 同期CLI: npm run profile:sync [-- --dry-run | --yes | --kb=<path>]
 *
 * knowledge-base(SSoT)を読み込み、LLMで匿名化・営業文体に変換し、
 * 禁止語スキャン・スキーマ検証を通った結果を diff 表示 → 人間の承認後に
 * profile.yaml と .kb-sync.json へ書き込む。
 *
 *   --dry-run  diff表示まで(書き込みなし)
 *   --yes      確認プロンプトをスキップ(diffは表示する)
 *   --kb=PATH  KBのパス(既定: 環境変数 KB_PATH → ../knowledge-base)
 */
import 'dotenv/config';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { loadProfile } from '../src/generator/profile.js';
import { diffLines } from '../src/sync/diff.js';
import { loadKbSnapshot } from '../src/sync/kbReader.js';
import { loadSalesConfig } from '../src/sync/salesConfig.js';
import { syncProfileFromKb } from '../src/sync/syncProfile.js';
import { KbTransformer } from '../src/sync/transformer.js';

const PROFILE_PATH = './profile.yaml';
const SALES_PATH = './sales.yaml';
const SYNC_RECORD_PATH = './.kb-sync.json';

function parseArgs(argv: readonly string[]): { dryRun: boolean; yes: boolean; kbDir: string } {
  const kbArg = argv.find((a) => a.startsWith('--kb='))?.slice('--kb='.length);
  return {
    dryRun: argv.includes('--dry-run'),
    yes: argv.includes('--yes'),
    kbDir: kbArg ?? process.env.KB_PATH ?? '../knowledge-base',
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { dryRun, yes, kbDir } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が設定されていません(.env を確認してください)');
  }

  console.log(`[sync] KB読み込み: ${kbDir}`);
  const kb = loadKbSnapshot(kbDir);
  const sales = loadSalesConfig(SALES_PATH);
  console.log(
    `[sync] works ${kb.works.length}件 / Lancers掲載 ${kb.lancersAllowlist.length}件 / 禁止語 ${kb.forbiddenTerms.length}語`,
  );

  console.log('[sync] LLM変換中(実績+経歴叙述)...');
  const result = await syncProfileFromKb(kb, sales, KbTransformer.fromApiKey(apiKey), new Date().toISOString());
  for (const warning of result.warnings) console.warn(`[sync] 警告: ${warning}`);
  console.log('[sync] 禁止語スキャン: 合格 / スキーマ検証: 合格');

  const current = existsSync(PROFILE_PATH) ? readFileSync(PROFILE_PATH, 'utf8') : '';
  const diff = diffLines(current, result.yamlText);
  if (!diff.hasChanges) {
    console.log('[sync] 現行 profile.yaml と差分はありません。');
    return;
  }
  console.log(`\n===== profile.yaml の差分 (+${diff.stats.added} / -${diff.stats.removed}) =====`);
  console.log(diff.text);
  console.log('===== 差分ここまで =====\n');

  if (dryRun) {
    console.log('[sync] --dry-run のため書き込みません。');
    return;
  }
  if (!yes && !(await confirm('この内容で profile.yaml を更新しますか?'))) {
    console.log('[sync] 中止しました(書き込みなし)。');
    return;
  }

  // 一時ファイルに書き、既存ローダーで読めることを確認してから rename で差し替える
  // (検証前に本体を上書きしない・部分書き込みで profile.yaml を壊さない)
  const tempPath = `${PROFILE_PATH}.new`;
  let reloaded;
  try {
    writeFileSync(tempPath, result.yamlText, 'utf8');
    reloaded = loadProfile(tempPath);
    renameSync(tempPath, PROFILE_PATH);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  console.log(
    `[sync] 完了: works ${reloaded.works.length}件 / strengths ${reloaded.strengths.length}件 / careerSummary ${reloaded.careerSummary.length}字`,
  );

  try {
    writeFileSync(SYNC_RECORD_PATH, `${JSON.stringify(result.record, null, 2)}\n`, 'utf8');
    console.log(`[sync] 鮮度記録を更新しました: ${SYNC_RECORD_PATH}`);
  } catch (error) {
    // profile.yaml は更新済み。鮮度記録だけ失敗した場合は次回起動時に stale 警告が出るに留まる
    console.warn(`[sync] 警告: 鮮度記録(${SYNC_RECORD_PATH})の書き込みに失敗しました。profile.yaml は更新済みです`);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error('[sync] 失敗:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
