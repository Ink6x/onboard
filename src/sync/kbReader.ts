import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractBlockquote,
  extractBulletItems,
  extractYamlBlock,
  findSection,
  lookupTableValue,
  parseSections,
  splitFrontmatter,
} from './markdown.js';
import {
  forbiddenTermsSchema,
  kbWorkFrontmatterSchema,
  lancersAllowlistSchema,
  type KbSnapshot,
  type KbWork,
} from './kbSchema.js';

/**
 * knowledge-base(SSoT)を読み込んで KbSnapshot に構造化する。
 * KBの書式が想定から外れた場合は黙って進めず、どのファイルの何が壊れているかを
 * 明示して throw する(fail-fast)。
 */

/** 同期が参照するKBファイル(KBルートからの相対パス)。ハッシュ記録の対象もこの集合。 */
const KB_FILES = {
  disclosure: 'DISCLOSURE.md',
  channels: 'channels/channels.md',
  profile: 'profile/profile.md',
  career: 'profile/career.md',
  selfPr: 'texts/self-pr.md',
  intro: 'texts/intro.md',
  outcomes: 'texts/outcomes.md',
} as const;

const WORKS_DIR = 'works';

function readKbFile(kbDir: string, relativePath: string): string {
  try {
    return readFileSync(join(kbDir, relativePath), 'utf8');
  } catch {
    throw new Error(`KBファイルが読めません: ${join(kbDir, relativePath)}`);
  }
}

/** works/*.md 1件をパースする(エクスポートはテスト用)。 */
export function parseWorkFile(content: string, relativePath: string): KbWork {
  const split = splitFrontmatter(content);
  if (!split) {
    throw new Error(`${relativePath}: frontmatter(--- 区切り)が見つかりません`);
  }
  const parsed = kbWorkFrontmatterSchema.safeParse(split.frontmatter);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ');
    throw new Error(`${relativePath}: frontmatterの検証に失敗しました(${issues})`);
  }
  return {
    slug: parsed.data.slug,
    name: parsed.data.name,
    disclosure: parsed.data.disclosure,
    stack: parsed.data.stack,
    links: parsed.data.links,
    sections: parseSections(split.body),
    relativePath,
  };
}

/** channels.md から Lancers 掲載 slug リストを抽出する(エクスポートはテスト用)。 */
export function extractLancersAllowlist(channelsMd: string): readonly string[] {
  const block = extractYamlBlock(channelsMd, 'lancers_works');
  if (!block) {
    throw new Error(
      'channels.md に lancers_works の機械可読ブロック(```yaml)が見つかりません。KBに Lancers 掲載実績リストを定義してください',
    );
  }
  const parsed = lancersAllowlistSchema.safeParse(block);
  if (!parsed.success) {
    throw new Error(`channels.md の lancers_works が不正です: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data.lancers_works;
}

/** DISCLOSURE.md から禁止語リストを抽出する(エクスポートはテスト用)。 */
export function extractForbiddenTerms(disclosureMd: string): readonly string[] {
  const block = extractYamlBlock(disclosureMd, 'forbidden_terms');
  if (!block) {
    throw new Error(
      'DISCLOSURE.md に forbidden_terms の機械可読ブロック(```yaml)が見つかりません。' +
        '禁止語検査なしの同期は許可されません(fail-closed)',
    );
  }
  const parsed = forbiddenTermsSchema.safeParse(block);
  if (!parsed.success) {
    throw new Error(`DISCLOSURE.md の forbidden_terms が不正です: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data.forbidden_terms;
}

/** profile.md の「公開名」行から表示名を取り出す(例: "Ink6x（GitHub等） / Jullien" → "Ink6x")。 */
export function extractDisplayName(profileMd: string): string {
  const cell = lookupTableValue(profileMd, '公開名', 1);
  const name = cell?.match(/^[A-Za-z0-9_+-]+/)?.[0];
  if (!name) {
    throw new Error('profile/profile.md の本人情報テーブルから「公開名」を抽出できません');
  }
  return name;
}

/** intro.md の肩書きテーブルから「公開（日本語）」の表記を取り出す。 */
export function extractHeadline(introMd: string): string {
  const headline = lookupTableValue(introMd, '公開（日本語）', 1);
  if (!headline) {
    throw new Error('texts/intro.md の肩書きテーブルから「公開（日本語）」を抽出できません');
  }
  return headline;
}

/** self-pr.md からショート版(公開)自己PRを取り出す。 */
export function extractIntroText(selfPrMd: string): string {
  const sections = parseSections(selfPrMd);
  const section = findSection(sections, 'ショート版');
  const text = section ? extractBlockquote(section) : null;
  if (!text) {
    throw new Error('texts/self-pr.md から「ショート版」の引用文を抽出できません');
  }
  return text.replace(/\n+/g, ''); // 引用の折返しを1文に連結
}

/** self-pr.md からスタンス・設計思想の要素文を取り出す。 */
export function extractStrengths(selfPrMd: string): readonly string[] {
  const sections = parseSections(selfPrMd);
  const section = findSection(sections, 'スタンス・設計思想');
  const items = section ? extractBulletItems(section) : [];
  if (items.length === 0) {
    throw new Error('texts/self-pr.md から「スタンス・設計思想」の要素文を抽出できません');
  }
  return items;
}

/**
 * 同期が参照するKBファイル一式を読み込む(パースなし)。
 * 鮮度照合(staleness)と同じファイル集合を共有するためにエクスポートする。
 */
export function collectKbFileContents(kbDir: string): Record<string, string> {
  const fileContents: Record<string, string> = {};
  for (const relativePath of Object.values(KB_FILES)) {
    fileContents[relativePath] = readKbFile(kbDir, relativePath);
  }

  let workFiles: readonly string[];
  try {
    workFiles = readdirSync(join(kbDir, WORKS_DIR))
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort();
  } catch {
    throw new Error(`KBの works ディレクトリが読めません: ${join(kbDir, WORKS_DIR)}`);
  }
  for (const file of workFiles) {
    const relativePath = `${WORKS_DIR}/${file}`;
    fileContents[relativePath] = readKbFile(kbDir, relativePath);
  }
  return fileContents;
}

/** KB全体を読み込み、構造化スナップショットを返す。 */
export function loadKbSnapshot(kbDir: string): KbSnapshot {
  const fileContents = collectKbFileContents(kbDir);
  // collectKbFileContents は KB_FILES 全件を必ず格納する。欠けは内部不整合として隠蔽せず落とす
  // (空文字でパイプラインが続行すると、空入力からの偽の生成物が検査をすり抜けかねない)
  const content = (relativePath: string): string => {
    const value = fileContents[relativePath];
    if (value === undefined) {
      throw new Error(`内部不整合: KBファイルが読み込まれていません: ${relativePath}`);
    }
    return value;
  };

  const works: KbWork[] = Object.keys(fileContents)
    .filter((relativePath) => relativePath.startsWith(`${WORKS_DIR}/`))
    .sort()
    .map((relativePath) => parseWorkFile(content(relativePath), relativePath));

  return {
    works,
    lancersAllowlist: extractLancersAllowlist(content(KB_FILES.channels)),
    forbiddenTerms: extractForbiddenTerms(content(KB_FILES.disclosure)),
    displayName: extractDisplayName(content(KB_FILES.profile)),
    headline: extractHeadline(content(KB_FILES.intro)),
    intro: extractIntroText(content(KB_FILES.selfPr)),
    strengths: extractStrengths(content(KB_FILES.selfPr)),
    careerMd: content(KB_FILES.career),
    outcomesMd: content(KB_FILES.outcomes),
    fileContents,
  };
}
