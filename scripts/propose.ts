/**
 * 手動・アドホック提案文生成CLI(DBに書き込まない・Telegramに送らない)。
 * 案件URL/テキスト/ファイル/inboxを入力に、スコアリング → 2段階生成 → 自己検査 →
 * 提案文+分析情報のMarkdown保存 まで行う。
 *
 * 使い方: npm run propose -- --url=<案件URL>
 *         npm run propose -- --text="案件本文" --title="タイトル"
 *         npm run propose -- --file=./job.md
 *         npm run propose -- --inbox=./proposals-inbox
 * (詳細は --help または src/propose/input.ts の USAGE を参照)
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fetchJobDetail } from '../src/collector/detailFetcher.js';
import { ClaudeProposalGenerator, validateProposal } from '../src/generator/claudeGenerator.js';
import { loadProfile } from '../src/generator/profile.js';
import { KeywordScorer } from '../src/generator/scorer.js';
import {
  buildJob,
  parseJobFile,
  parseProposeArgs,
  USAGE,
  type ProposeArgs,
} from '../src/propose/input.js';
import { proposalFileName, renderProposalMarkdown } from '../src/propose/output.js';
import { checkProfileStaleness } from '../src/sync/staleness.js';
import type { Job } from '../src/types.js';
import type { Profile } from '../src/generator/profile.js';

const DEFAULT_OUT_DIR = './data/proposals-out';
const SYNC_RECORD_PATH = './.kb-sync.json';
const MAX_INBOX_FILES = 20; // API課金のガード(1件あたり最大3回のClaude呼び出し)

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const args = parseProposeArgs(process.argv.slice(2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が設定されていません(.env を確認してください)');
  }
  const profile = loadProfile(process.env.PROFILE_PATH ?? './profile.yaml');

  // profile.yaml の鮮度チェック(警告のみ。生成は止めない)
  const staleness = checkProfileStaleness(process.env.KB_PATH ?? '../knowledge-base', SYNC_RECORD_PATH);
  if (staleness.status !== 'fresh') {
    console.warn(`[propose] 注意: ${staleness.message}`);
  }

  const generator = new ClaudeProposalGenerator(apiKey);

  if (args.source.kind === 'inbox') {
    await runInbox(args.source.dir, args, profile, generator);
    return;
  }

  const job = await resolveJob(args);
  const outPath = args.out ?? join(DEFAULT_OUT_DIR, proposalFileName(job.title, new Date()));
  await generateOne(job, profile, generator, outPath);
}

/** 入力元(URL/テキスト/ファイル)から生成対象のJobを組み立てる。 */
async function resolveJob(args: ProposeArgs): Promise<Job> {
  const meta = {
    budgetText: args.budget,
    category: args.category,
    deadline: args.deadline,
    proposalCount: args.proposalCount,
  };

  switch (args.source.kind) {
    case 'url': {
      const url = args.source.url;
      console.log(`[propose] 詳細ページ取得中: ${url}`);
      const detail = await fetchJobDetail(url);
      if (!detail?.description) {
        console.warn(
          '[propose] 依頼概要を取得できませんでした(Lancers詳細ページ以外のURLは未対応です)。' +
            '--text= または --file= で案件本文を渡すと品質が上がります',
        );
      } else {
        console.log(`[propose] 依頼概要: ${detail.description.length}字 / 業種: ${detail.industry ?? '不明'}`);
      }
      return buildJob({
        url,
        title: args.title ?? detail?.description?.split('\n')[0]?.slice(0, 60) ?? '(タイトル不明)',
        description: detail?.description,
        ...meta,
        proposalCount: args.proposalCount ?? detail?.proposalCount,
      });
    }
    case 'text':
      // parseProposeArgs が --text には --title 必須を保証している
      return buildJob({ url: '', title: args.title as string, description: args.source.text, ...meta });
    case 'file': {
      const parsed = parseJobFile(readFileSync(args.source.path, 'utf8'));
      return buildJob({ url: '', title: args.title ?? parsed.title, description: parsed.description, ...meta });
    }
    case 'inbox':
      throw new Error('inboxモードは runInbox で処理される(到達しない)');
  }
}

/** 1件の生成: スコア → 2段階生成 → 自己検査 → Markdown保存+コンソール表示。 */
async function generateOne(
  job: Job,
  profile: Profile,
  generator: ClaudeProposalGenerator,
  outPath: string,
): Promise<void> {
  const score = new KeywordScorer().score(job, profile);
  console.log(`[propose] スコア: ${score.score} (${score.reason})`);

  console.log('[propose] 提案文生成中…');
  const { content: proposal, analysis } = await generator.generate(job, profile, score);
  const issues = validateProposal(proposal, job, analysis?.recommendedLength);

  console.log(`\n--- 提案文 (${proposal.length}字) ---\n${proposal}\n---`);
  console.log(`自己検査: ${issues.length === 0 ? 'OK' : issues.join(' / ')}`);

  const markdown = renderProposalMarkdown({
    job,
    score,
    analysis,
    proposal,
    issues,
    generatedAt: new Date().toLocaleString('ja-JP'),
  });
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, markdown, 'utf8');
  console.log(`[propose] 保存しました: ${outPath}`);
}

/**
 * inbox一括生成: ディレクトリ内の *.md/*.txt を順次生成し、成功したファイルは done/ へ移動する。
 * 1件の失敗で全体を止めない(失敗ファイルは inbox に残り、再実行で再試行される)。
 */
async function runInbox(
  rawDir: string,
  args: ProposeArgs,
  profile: Profile,
  generator: ClaudeProposalGenerator,
): Promise<void> {
  // 境界検証: パスを正規化し、ディレクトリとして実在することを確認してから読む
  const dir = resolve(rawDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`--inbox に指定されたディレクトリが見つかりません: ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((name) => /\.(md|txt)$/i.test(name))
    .sort();
  if (files.length === 0) {
    console.log(`[propose] ${dir} に処理対象(*.md / *.txt)がありません`);
    return;
  }
  if (files.length > MAX_INBOX_FILES) {
    throw new Error(
      `inboxに${files.length}件あります。API課金ガードのため一度に処理できるのは${MAX_INBOX_FILES}件までです`,
    );
  }

  const outDir = args.out ?? DEFAULT_OUT_DIR;
  const doneDir = join(dir, 'done');
  mkdirSync(doneDir, { recursive: true });
  let succeeded = 0;
  const failed: string[] = [];

  for (const [index, name] of files.entries()) {
    const filePath = join(dir, name);
    console.log(`\n[propose] (${index + 1}/${files.length}) ${name}`);
    try {
      const parsed = parseJobFile(readFileSync(filePath, 'utf8'));
      const job = buildJob({
        url: '',
        title: parsed.title,
        description: parsed.description,
        budgetText: args.budget,
        category: args.category,
        deadline: args.deadline,
        proposalCount: args.proposalCount,
      });
      const outPath = join(outDir, proposalFileName(job.title, new Date()));
      await generateOne(job, profile, generator, outPath);
      renameSync(filePath, join(doneDir, name));
      succeeded++;
    } catch (error) {
      failed.push(name);
      console.error(`[propose] ${name} の処理に失敗(継続します):`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\n[propose] 完了: 成功 ${succeeded}件 / 失敗 ${failed.length}件`);
  if (failed.length > 0) {
    console.log(`[propose] 失敗ファイル(inboxに残置、再実行で再試行): ${failed.join(', ')}`);
  }
}

main().catch((error: unknown) => {
  console.error('[propose] 失敗:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
