import { google, type gmail_v1 } from 'googleapis';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Job } from '../types.js';
import { parseLancersEmail } from './parser.js';
import { insertJobIfNew, isEmailProcessed, markEmailProcessed } from '../store/jobs.js';
import { logEvent } from '../store/audit.js';
import { htmlToText } from '../lib/html.js';

/** Gmail APIクライアントを生成する。リフレッシュトークン未設定なら null。 */
export function createGmailClient(config: Config): gmail_v1.Gmail | null {
  if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET || !config.GMAIL_REFRESH_TOKEN) {
    return null;
  }
  const auth = new google.auth.OAuth2(config.GMAIL_CLIENT_ID, config.GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: config.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

/**
 * Lancers通知メールをポーリングし、新規案件をDBへ登録する。
 * メールIDではなく案件URLで冪等化しているため、同じ案件が複数メールに
 * 含まれていても二重登録されない。
 * @returns 新規登録されたJobの配列
 */
export async function pollGmail(
  gmail: gmail_v1.Gmail,
  db: Database.Database,
  query: string,
): Promise<readonly Job[]> {
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
  const messages = list.data.messages ?? [];
  const newJobs: Job[] = [];

  for (const message of messages) {
    if (!message.id) continue;
    if (isEmailProcessed(db, message.id)) continue;

    const full = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
    const body = extractPlainText(full.data.payload);
    if (body) {
      const candidates = parseLancersEmail(body);
      for (const candidate of candidates) {
        const job = insertJobIfNew(db, candidate, 'gmail', message.id);
        if (job) {
          logEvent(db, job.id, 'job:created', { url: job.url, emailId: message.id });
          newJobs.push(job);
        }
      }
    }
    markEmailProcessed(db, message.id);
    logEvent(db, null, 'email:processed', { emailId: message.id });
  }

  return newJobs;
}

/** MIMEツリーから text/plain パートを探してデコードする。 */
function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string | null {
  if (!payload) return null;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const found = extractPlainText(part);
    if (found) return found;
  }
  // text/plainが無いHTMLメールはタグを落として代用する
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    return htmlToText(html);
  }
  return null;
}
