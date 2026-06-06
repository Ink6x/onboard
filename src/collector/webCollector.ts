import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Job } from '../types.js';
import type { Page } from 'playwright';
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
import {
  getCollectorState,
  setCollectorState,
  getDailyCount,
  incrementDailyCount,
} from '../store/collectorState.js';
import { logEvent } from '../store/audit.js';

/**
 * Lancers検索一覧の巡回収集器。2つのモードを持つ:
 * - anonymous: 未ログインHTTP優先、ブロック時のみPlaywright(別プロファイル)退避。高頻度の主軸。
 * - logged_in: ログイン済みプロファイル(submitterと共有)で取得。限定公開・完全非公開案件を
 *   拾うため。アカウント帰属の足跡が乗るので低頻度+日次上限で運用する。
 *
 * いずれも案件は insertJobIfNew(URL冪等)で登録するため、Gmail経由・他モードと重複しない。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_NAV_TIMEOUT_MS = 30_000;
// リクエスト間のランダム待機(バースト的なアクセスを避ける)
const INTER_REQUEST_DELAY_MIN_MS = 3_000;
const INTER_REQUEST_DELAY_MAX_MS = 8_000;
// ログイン巡回はより慎重に(人間的な間隔)
const LOGGED_IN_DELAY_MIN_MS = 5_000;
const LOGGED_IN_DELAY_MAX_MS = 12_000;

const ANON_ROTATION_KEY = 'web:rotation';
const ANON_ZERO_STREAK_KEY = 'web:zero_streak';
const LOGGED_IN_ROTATION_KEY = 'web:rotation:loggedin';
const LOGGED_IN_ZERO_STREAK_KEY = 'web:zero_streak:loggedin';
const LOGGED_IN_DAILY_PREFIX = 'web:loggedin:count';
// 全ターゲット0件のtickがこの回数続いたら構造変化の可能性を通知する
const ZERO_STREAK_ALERT_THRESHOLD = 3;

export interface WebCollectorDeps {
  readonly db: Database.Database;
  readonly config: Config;
  notify(text: string): Promise<void>;
}

// ============================================================
// 匿名モード(主軸・高頻度)
// ============================================================

/**
 * 1tick分の匿名巡回を実行し、新規登録されたJobを返す。
 * 個々のターゲットの失敗は巡回全体を止めない。
 */
export async function collectFromWeb(deps: WebCollectorDeps): Promise<readonly Job[]> {
  const { db, config } = deps;
  const plan = planFromConfig(db, config, ANON_ROTATION_KEY);
  if (plan.targets.length === 0) return [];

  const newJobs: Job[] = [];
  let parsedTotal = 0;
  let fallbackUsed = false;

  for (const [index, target] of plan.targets.entries()) {
    if (index > 0) await sleep(randomDelayMs(INTER_REQUEST_DELAY_MIN_MS, INTER_REQUEST_DELAY_MAX_MS));

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
      // 限定公開はタイトルが「限定公開の仕事」のままで匿名では正しく扱えない。
      // ここで登録すると後続のログイン巡回が実タイトルで上書きできなくなる(URL冪等)ため、
      // 匿名巡回では登録せずログイン巡回に委ねる。
      const registrable = candidates.filter((c) => !isPrivatePlaceholder(c.title));
      newJobs.push(...registerCandidates(db, registrable, target, 'web'));
    } catch (error) {
      console.warn(`[web] ${url} の巡回に失敗:`, error);
      logEvent(db, null, 'web:target_error', { target: target.value, message: String(error) });
    }
  }

  setCollectorState(db, ANON_ROTATION_KEY, JSON.stringify(plan.next));
  logEvent(db, null, 'web:tick', {
    mode: 'anonymous',
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
  await trackZeroStreak(deps, ANON_ZERO_STREAK_KEY, parsedTotal, '(匿名)');
  return newJobs;
}

// ============================================================
// ログインモード(限定公開狙い・低頻度・日次上限)
// ============================================================

/**
 * 1tick分のログイン巡回を実行する。submitterと共有のログイン済みプロファイルを使い、
 * 限定公開・完全非公開案件のタイトルを取得する。
 *
 * セッション切れ時は自動再ログインせず通知のみ(不審なログイン連発を避ける)。
 * 日次上限(WEB_LOGGED_IN_MAX_PER_DAY)に達したら以降のtickは何もしない。
 */
export async function collectFromWebLoggedIn(deps: WebCollectorDeps): Promise<readonly Job[]> {
  const { db, config } = deps;

  const usedToday = getDailyCount(db, LOGGED_IN_DAILY_PREFIX);
  const remaining = config.WEB_LOGGED_IN_MAX_PER_DAY - usedToday;
  if (remaining <= 0) {
    logEvent(db, null, 'web:loggedin_capped', { usedToday });
    return [];
  }

  // 日次残量と1tick予算の小さい方だけ巡回する
  const plan = planFromConfig(db, config, LOGGED_IN_ROTATION_KEY, remaining);
  if (plan.targets.length === 0) return [];

  // ログイン詳細取得は遅延importで起動コストを必要時のみに限定する
  const { launchBrowser, isLoggedIn } = await import('../submitter/browser.js');
  const { withBrowserLock } = await import('../submitter/browserLock.js');

  return withBrowserLock(async () => {
    const session = await launchBrowser({
      profileDir: config.PLAYWRIGHT_PROFILE_DIR,
      headless: config.WEB_LOGGED_IN_HEADLESS,
      ...(config.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: config.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
      ...(config.PLAYWRIGHT_CHANNEL ? { channel: config.PLAYWRIGHT_CHANNEL } : {}),
    });

    const newJobs: Job[] = [];
    let parsedTotal = 0;
    try {
      const page = await session.newPage();
      if (!(await isLoggedIn(page))) {
        logEvent(db, null, 'web:loggedin_needs_login');
        await deps.notify(
          '🔑 Lancersのログインが切れているため、ログイン巡回をスキップしました。<code>npm run lancers:login</code> で再ログインしてください(匿名巡回は継続中)。',
        );
        return [];
      }

      for (const [index, target] of plan.targets.entries()) {
        if (index > 0) await sleep(randomDelayMs(LOGGED_IN_DELAY_MIN_MS, LOGGED_IN_DELAY_MAX_MS));

        const url = buildSearchUrl(target, config.WEB_SEARCH_BUDGET_FROM);
        try {
          const html = await fetchListingViaPage(page, url);
          const candidates = parseSearchResults(html);
          parsedTotal += candidates.length;
          newJobs.push(...registerCandidates(db, candidates, target, 'web_loggedin'));
          incrementDailyCount(db, LOGGED_IN_DAILY_PREFIX);
        } catch (error) {
          console.warn(`[web:loggedin] ${url} の巡回に失敗:`, error);
          logEvent(db, null, 'web:loggedin_target_error', {
            target: target.value,
            message: String(error),
          });
        }
      }
    } finally {
      await session.close();
    }

    setCollectorState(db, LOGGED_IN_ROTATION_KEY, JSON.stringify(plan.next));
    logEvent(db, null, 'web:tick', {
      mode: 'logged_in',
      method: plan.targets[0]?.method,
      targets: plan.targets.map((t) => t.value),
      parsed: parsedTotal,
      new: newJobs.length,
    });
    await trackZeroStreak(deps, LOGGED_IN_ZERO_STREAK_KEY, parsedTotal, '(ログイン)');
    return newJobs;
  });
}

// ============================================================
// 共有ヘルパー
// ============================================================

/** 設定からターゲットリストを構築し、ローテーション計画を立てる。 */
function planFromConfig(
  db: Database.Database,
  config: Config,
  rotationKey: string,
  maxTargets?: number,
): ReturnType<typeof planTick> {
  const keywords = parseTargetList(config.WEB_SEARCH_KEYWORDS);
  const categories = parseTargetList(config.WEB_SEARCH_CATEGORIES);
  const perTick = Math.min(config.WEB_TARGETS_PER_TICK, maxTargets ?? Number.MAX_SAFE_INTEGER);
  const state = loadRotationState(db, rotationKey);
  return planTick(state, keywords, categories, Math.max(1, perTick));
}

/** 案件候補をDB登録し、新規分を返す(insert + 監査ログ)。 */
function registerCandidates(
  db: Database.Database,
  candidates: readonly { url: string; title: string; budgetText?: string; category?: string; deadline?: string }[],
  target: SearchTarget,
  source: Job['source'],
): readonly Job[] {
  const newJobs: Job[] = [];
  for (const candidate of candidates) {
    const job = insertJobIfNew(db, candidate, source, null);
    if (job) {
      logEvent(db, job.id, 'job:created', { url: job.url, source, target: target.value });
      newJobs.push(job);
    }
  }
  return newJobs;
}

/** 連続0件カウンタを更新し、閾値到達時に一度だけ構造変化の可能性を通知する。 */
async function trackZeroStreak(
  deps: WebCollectorDeps,
  key: string,
  parsedTotal: number,
  label: string,
): Promise<void> {
  const { db } = deps;
  if (parsedTotal > 0) {
    setCollectorState(db, key, '0');
    return;
  }
  const streak = Number(getCollectorState(db, key) ?? '0') + 1;
  setCollectorState(db, key, String(streak));
  if (streak === ZERO_STREAK_ALERT_THRESHOLD) {
    await deps.notify(
      `⚠️ Lancers一覧の巡回${label}が${streak}回連続で0件です。ページ構造の変化か取得ブロックの可能性があります(他の収集経路は継続中)。`,
    );
  }
}

function loadRotationState(db: Database.Database, key: string): RotationState {
  const raw = getCollectorState(db, key);
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

/** 匿名: HTTP優先で一覧HTMLを取得し、ブロック時のみPlaywrightに退避する。 */
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

/** ログイン済みPageで一覧HTMLを取得する(セッションは呼び出し側が保持)。 */
async function fetchListingViaPage(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_NAV_TIMEOUT_MS });
  await page.waitForTimeout(1200);
  return page.content();
}

/**
 * 匿名退避用Playwright。submitterの永続プロファイルとは別ディレクトリを使い、
 * 応募送信中のブラウザとプロファイルロックが競合しないようにする。
 * (匿名一覧は未ログインで閲覧できるためログインCookieは不要)
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

/** 匿名一覧で限定公開案件に付くプレースホルダタイトルか(実タイトルはログインでのみ取得可)。 */
export function isPrivatePlaceholder(title: string): boolean {
  return title.includes('限定公開');
}

function randomDelayMs(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
