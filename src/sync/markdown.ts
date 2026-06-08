import { parse } from 'yaml';

/**
 * knowledge-base のMarkdownを構造化して読むための純関数群。
 * KB側の書式(frontmatter / ## セクション / ```yaml ブロック / テーブル)に依存するため、
 * 書式が崩れた場合は黙って空を返さず、呼び出し側で fail-fast できるよう null を返す。
 */

export interface FrontmatterResult {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

/** `---` 区切りのYAML frontmatterと本文を分離する。frontmatterが無ければ null。 */
export function splitFrontmatter(content: string): FrontmatterResult | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match?.[1]) return null;
  const parsed: unknown = parse(match[1]);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { frontmatter: parsed as Record<string, unknown>, body: match[2] ?? '' };
}

/**
 * `## 見出し` 単位で本文を分割する。
 * 見出しテキストは「概要（1段落）」のような付記ゆれがあるため、呼び出し側は
 * findSection() の前方一致で引くこと。
 */
export function parseSections(body: string): ReadonlyMap<string, string> {
  const normalized = body.replace(/\r\n/g, '\n');
  const sections = new Map<string, string>();
  const matches = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const heading = current?.[1];
    if (!current || !heading) continue;
    const start = (current.index ?? 0) + current[0].length;
    const end = matches[i + 1]?.index ?? normalized.length;
    sections.set(heading.trim(), normalized.slice(start, end).trim());
  }
  return sections;
}

/** セクション見出しの前方一致でセクション本文を引く。見つからなければ null。 */
export function findSection(sections: ReadonlyMap<string, string>, headingPrefix: string): string | null {
  for (const [heading, text] of sections) {
    if (heading.startsWith(headingPrefix)) return text;
  }
  return null;
}

/**
 * Markdown中の ```yaml フェンスブロックのうち、指定キーを含む最初のものをパースして返す。
 * 該当ブロックが無い・キー欠落の場合は null(呼び出し側で fail-closed にする)。
 * パース不能なブロックがあれば throw する(壊れた設定で誤ったブロックが選ばれる事故を防ぐ)。
 */
export function extractYamlBlock(markdown: string, requiredKey: string): Record<string, unknown> | null {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const blocks = [...normalized.matchAll(/```ya?ml\n([\s\S]*?)```/g)];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = parse(block[1] ?? '');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Markdown内のyamlブロックがパースできません(${requiredKey} の探索中): ${message}`);
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && requiredKey in parsed) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Markdownテーブルから「最初の列が指定ラベルに一致する行」の指定列の値を返す。
 * 例: lookupTableValue(md, '公開名', 1) → 2列目の値。見つからなければ null。
 */
export function lookupTableValue(markdown: string, rowLabel: string, valueColumn: number): string | null {
  const normalized = markdown.replace(/\r\n/g, '\n');
  for (const line of normalized.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells[0] === rowLabel && cells.length > valueColumn) return cells[valueColumn] ?? null;
  }
  return null;
}

/** blockquote(`> `)行を連結して本文として返す。該当行が無ければ null。 */
export function extractBlockquote(sectionText: string): string | null {
  const lines = sectionText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('>'))
    .map((line) => line.replace(/^\s*>\s?/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  return lines.join('\n');
}

/**
 * `- 「要素文」（付記）` 形式の箇条書きから「」内の要素文だけを抽出する。
 * 「」が無い行は行全体(先頭の `- ` を除く)を使う。
 */
export function extractBulletItems(sectionText: string): readonly string[] {
  const items: string[] = [];
  for (const line of sectionText.replace(/\r\n/g, '\n').split('\n')) {
    const text = line.match(/^\s*-\s+(.+)$/)?.[1];
    if (!text) continue;
    items.push((text.match(/^「(.+?)」/)?.[1] ?? text).trim());
  }
  return items;
}
