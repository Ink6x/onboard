import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Job } from '../types.js';
import { parseSearchResults } from './searchParser.js';
import {
  INITIAL_ROTATION_STATE,
  buildSearchUrl,
  parseTargetList,
  planTick,
  type RotationState,
  type SearchTarget,
} from './searchTargets.js';
import { insertJobIfNew } from '../store/jobs.js';
import { getCollectorState, setCollectorState } from '../store/collectorState.js';
import { logEvent } from '../store/audit.js';

/**
 * Lancers検索一覧の巡回収集器。
 * HTTP優先で取得し、ブロック(403/429等)や取得失敗時のみPlaywrightに退避する。
 * 取得した案件は insertJobIfNew (URL冪等)で登録するため、Gmail経由と重複しない。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_NAV_TIMEOUT_MS = 30_000;
// リクエスト間のランダム待機(バースト的なアクセスを避ける)
const INTER_REQUEST_DELAY_MIN_MS = 3_000;
const INTER_REQUEST_DELAY_MAX_MS = 8_000;

const ROTATION_KEY = 'web:rotation';
const ZERO_STREAK_KEY = 'web:zero_streak';
// 全ターゲット0件のtickがこの回数続いたら構造変化の可能性を通知する
const ZERO_STREAK_ALERT_THRESHOLD = 3;

export interface WebCollectorDeps {
  readonly db: Database.Database;
  readonly config: Config;
  notify(text: string): Promise<void>;
}

/**
 * 1tick分の巡回を実行し、新規登録されたJobを返す。
 * 個々のターゲットの失敗は巡回全体を止めない。
 */
export async function collectFromWeb(deps: WebCollectorDeps): Promise<readonly Job[]> {
  const { db, config } = deps;
  const keywords = parseTargetList(config.WEB_SEARCH_KEYWORDS);
  const categories = parseTargetList(config.WEB_SEARCH_CATEGORIES);

  const state = loadRotationState(db);
  const plan = planTick(state, keywords, categories, config.WEB_TARGETS_PER_TICK);
  if (plan.targets.length === 0) return [];

  const newJobs: Job[] = [];
  let parsedTotal = 0;
  let fallbackUsed = false;

  for (const [index, target] of plan.targets.entries()) {
    if (index > 0) await sleep(randomDelayMs());

    const url = buildSearchUrl(target, config.WEB_SEARCH_BUDGET_FROM);
    try {
      const result = await fetchListingHtml(url, config);
      if (!result) {
        logEvent(db, null, 'web:fetch_failed', { target: target.value, url });
        continue;
      }
      if (result.viaBrowser) fallbackUsed = true;

      const candidates = parseSearchResults(result.html);
      parsedTotal += candidates.length;
      for (const candidate of candidates) {
        const job = insertJobIfNew(db, candidate, 'web', null);
        if (job) {
          logEvent(db, job.id, 'job:created', { url: job.url, source: 'web', target: target.value });
          newJobs.push(job);
        }
      }
    } catch (error) {
      console.warn(`[web] ${url} の巡回に失敗:`, error);
      logEvent(db, null, 'web:target_error', { target: target.value, message: String(error) });
    }
  }

  setCollectorState(db, ROTATION_KEY, JSON.stringify(plan.next));
  logEvent(db, null, 'web:tick', {
    method: plan.targets[0]?.method,
    targets: plan.targets.map((t) => t.value),
    parsed: parsedTotal,
    new: newJobs.length,
    fallbackUsed,
  });

  if (fallbackUsed) {
    await deps.notify(
      '⚠️ Lancers一覧のHTTP取得がブロックされ、Playwright退避で取得しました。bot検知の兆候かもしれません。',
    );
  }
  await trackZeroStreak(deps, parsedTotal);

  return newJobs;
}

/** 連続0件カウンタを更新し、閾値到達時に一度だけ構造変化の可能性を通知する。 */
async function trackZeroStreak(deps: WebCollectorDeps, parsedTotal: number): Promise<void> {
  const { db } = deps;
  if (parsedTotal > 0) {
    setCollectorState(db, ZERO_STREAK_KEY, '0');
    return;
  }
  const streak = Number(getCollectorState(db, ZERO_STREAK_KEY) ?? '0') + 1;
  setCollectorState(db, ZERO_STREAK_KEY, String(streak));
  if (streak === ZERO_STREAK_ALERT_THRESHOLD) {
    await deps.notify(
      `⚠️ Lancers一覧の巡回が${streak}回連続で0件です。ページ構造の変化か取得ブロックの可能性があります(Gmail収集は継続中)。`,
    );
  }
}

function loadRotationState(db: Database.Database): RotationState {
  const raw = getCollectorState(db, ROTATION_KEY);
  if (!raw) return INITIAL_ROTATION_STATE;
  try {
    return { ...INITIAL_ROTATION_STATE, ...(JSON.parse(raw) as Partial<RotationState>) };
  } catch {
    return INITIAL_ROTATION_STATE;
  }
}

interface ListingFetchResult {
  readonly html: string;
  readonly viaBrowser: boolean;
}

/** HTTP優先で一覧HTMLを取得し、ブロック時のみPlaywrightに退避する。 */
async function fetchListingHtml(url: string, config: Config): Promise<ListingFetchResult | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      return { html: await response.text(), viaBrowser: false };
    }
    console.warn(`[web] ${url} → HTTP ${response.status}、Playwright退避を試みます`);
  } catch (error) {
    console.warn(`[web] ${url} のHTTP取得に失敗、Playwright退避を試みます:`, error);
  }

  const html = await fetchViaBrowser(url, config);
  return html ? { html, viaBrowser: true } : null;
}

/**
 * Playwright退避。submitterの永続プロファイルとは別ディレクトリを使い、
 * 応募送信中のブラウザとプロファイルロックが競合しないようにする。
 * (一覧は未ログインで閲覧できるためログインCookieは不要)
 */
async function fetchViaBrowser(url: string, config: Config): Promise<string | null> {
  try {
    const { launchBrowser } = await import('../submitter/browser.js');
    const session = await launchBrowser({
      profileDir: `${config.PLAYWRIGHT_PROFILE_DIR}-collector`,
      headless: true,
      ...(config.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
      ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
    });
    try {
      const page = await session.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_NAV_TIMEOUT_MS });
      return await page.content();
    } finally {
      await session.close();
    }
  } catch (error) {
    console.warn(`[web] Playwright退避にも失敗:`, error);
    return null;
  }
}

function randomDelayMs(): number {
  return (
    INTER_REQUEST_DELAY_MIN_MS +
    Math.random() * (INTER_REQUEST_DELAY_MAX_MS - INTER_REQUEST_DELAY_MIN_MS)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
