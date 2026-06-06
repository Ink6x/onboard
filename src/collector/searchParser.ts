import type { JobCandidate } from '../types.js';
import { canonicalWorkUrl } from './parser.js';
import { htmlToText } from '../lib/html.js';

/**
 * Lancers検索一覧ページ(/work/search...)のパーサー。
 * 未ログインHTTPで取得できることを実機確認済み(2026-06-06)。
 *
 * 一覧の本体リストにはエージェント求人(tech-agent.lancers.jp への外部リンク)が
 * 大量に混在するが、本物のクラウドソーシング案件だけが
 * `onclick="goToLjpWorkDetail(<id>)"` のラッパーを持つため、それを区切りに抽出する。
 * ページ右の「新着の仕事」サイドバーはこのマーカーを持たないため自然に除外される。
 */

const ITEM_MARKER = /goToLjpWorkDetail\((\d+)\)/g;
// 本体リストの終端候補(最終アイテムのブロックがサイドバー等へ食い込まないように切る)
const LIST_END_MARKERS = ['p-search-job__pager', 'p-search-job__latest-heading'] as const;

export function parseSearchResults(html: string): readonly JobCandidate[] {
  const matches = [...html.matchAll(ITEM_MARKER)];
  const candidates: JobCandidate[] = [];
  const seenIds = new Set<string>();

  matches.forEach((match, index) => {
    const workId = match[1];
    const start = match.index;
    if (!workId || start === undefined || seenIds.has(workId)) return;

    const end = matches[index + 1]?.index ?? findListEnd(html, start);
    const candidate = parseItemBlock(html.slice(start, end), workId);
    if (candidate) {
      seenIds.add(workId);
      candidates.push(candidate);
    }
  });

  return candidates;
}

function findListEnd(html: string, after: number): number {
  const positions = LIST_END_MARKERS.map((marker) => html.indexOf(marker, after)).filter(
    (i) => i !== -1,
  );
  return positions.length > 0 ? Math.min(...positions) : html.length;
}

/** 1案件ブロックからタイトル・予算・残り日数・サブカテゴリを抽出する。 */
function parseItemBlock(block: string, workId: string): JobCandidate | null {
  // タイトルアンカーは自身のworkIdへのhrefを持つ(隣接ブロックへの食い込みガード)
  const titleMatch = block.match(
    new RegExp(
      `<a class="p-search-job-media__title[^"]*"\\s+href="/work/detail/${workId}">([\\s\\S]*?)</a>`,
    ),
  );
  if (!titleMatch?.[1]) return null;
  // タイトル内のタグリスト(NEW等)を除去してからテキスト化
  const title = collapseWhitespace(htmlToText(titleMatch[1].replace(/<ul[\s\S]*?<\/ul>/g, '')));
  if (!title) return null;

  // 例: "プロジェクト 20,000 円 ~ 50,000 円 / 固定"(方式バッジ込みで保持する)
  const statsMatch = block.match(/class="c-media__job-stats-item">([\s\S]*?)<\/div>/);
  const budgetText = statsMatch?.[1] ? collapseWhitespace(htmlToText(statsMatch[1])) : '';

  // 例: "あと6日"(一覧は相対表記のみ。絶対日時は詳細ページ側にある)
  const deadlineMatch = block.match(/p-search-job-media__time-remaining">([^<]*)</);
  const deadline = deadlineMatch?.[1]?.trim() ?? '';

  // 例: "ChatGPT開発"(最初のサブカテゴリリンク)
  const categoryMatch = block.match(/p-search-job__division-link"[^>]*>([^<]+)</);
  const category = categoryMatch?.[1]?.trim() ?? '';

  return {
    url: canonicalWorkUrl(workId),
    title,
    ...(budgetText ? { budgetText } : {}),
    ...(deadline ? { deadline } : {}),
    ...(category ? { category } : {}),
  };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
