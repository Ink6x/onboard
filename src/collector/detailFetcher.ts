import { htmlToText } from '../lib/html.js';

/**
 * Lancers案件詳細ページ(/work/detail/<id>)から提案文の材料を取得する。
 * 未ログインで閲覧可能なことを実機確認済み(2026-06-05)。
 * 1案件につき1回だけ取得し、失敗してもパイプラインは止めない(メール情報のみで続行)。
 */

export interface JobDetail {
  readonly description: string | null; // 依頼概要(追記含む)
  readonly industry: string | null; // 依頼主の業種
  readonly proposalCount: number | null; // 既存提案数(下限値。「もっと見る(+N)」のN)
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_DESCRIPTION_CHARS = 4000;

export async function fetchJobDetail(url: string): Promise<JobDetail | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[detail] ${url} → HTTP ${response.status}`);
      return null;
    }
    return parseJobDetailHtml(await response.text());
  } catch (error) {
    console.warn(`[detail] ${url} の取得に失敗:`, error);
    return null;
  }
}

/** 詳細ページHTMLのパース(純関数。tests/fixtures/detail-sample.html で検証)。 */
export function parseJobDetailHtml(html: string): JobDetail {
  const sections: string[] = [];

  const overview = matchDefinitionAfterTerm(html, '依頼概要');
  if (overview) sections.push(overview);

  // 「依頼公開後の追記内容」(cp-term)ブロック
  const appendixPattern =
    /<dt class="c-definition-list__term cp-term"><\/dt>\s*<dd class="c-definition-list__description">([\s\S]*?)<\/dd>/g;
  for (const match of html.matchAll(appendixPattern)) {
    const text = htmlToText(match[1] ?? '');
    if (text) sections.push(`【追記】\n${text}`);
  }

  const description = sections.length > 0 ? sections.join('\n\n').slice(0, MAX_DESCRIPTION_CHARS) : null;
  const industry = matchDefinitionAfterTerm(html, '依頼主の業種');

  const proposalMatch = html.match(/もっと見る\s*\(\+(\d+)\)/);
  const proposalCount = proposalMatch?.[1] ? Number(proposalMatch[1]) : null;

  return { description, industry, proposalCount };
}

/** `<dt>…term…</dt>` の直後の `<dd class="c-definition-list__description">` をテキスト化する。 */
function matchDefinitionAfterTerm(html: string, term: string): string | null {
  const pattern = new RegExp(
    `<dt class="c-definition-list__term">[\\s\\S]{0,200}?${term}[\\s\\S]*?<dd class="c-definition-list__description">([\\s\\S]*?)<\\/dd>`,
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  const text = htmlToText(match[1]);
  return text || null;
}
