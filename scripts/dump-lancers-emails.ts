/**
 * パーサー仕様確定用: 設定済みGmailアカウントからLancers関連メールを検索し、
 * 件名一覧の表示と本文サンプルの保存(data/email-samples/)を行う。
 *
 * 使い方: npx tsx scripts/dump-lancers-emails.ts [検索クエリ]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { createGmailClient } from '../src/collector/gmailPoller.js';
import type { gmail_v1 } from 'googleapis';

const OUT_DIR = './data/email-samples';
const MAX_SAMPLES = 5;

async function main(): Promise<void> {
  const config = loadConfig();
  const gmail = createGmailClient(config);
  if (!gmail) throw new Error('Gmail OAuthが未設定です');

  const query = process.argv[2] ?? 'from:lancers.jp';
  console.log(`検索クエリ: ${query}\n`);

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 30 });
  const messages = list.data.messages ?? [];
  if (messages.length === 0) {
    console.log('該当するメールが見つかりませんでした。');
    console.log('別のクエリを試してください: npx tsx scripts/dump-lancers-emails.ts "lancers"');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`${messages.length}件ヒット。件名一覧:\n`);

  for (const [index, message] of messages.entries()) {
    if (!message.id) continue;
    const full = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
    const headers = full.data.payload?.headers ?? [];
    const subject = headerValue(headers, 'Subject');
    const from = headerValue(headers, 'From');
    const date = headerValue(headers, 'Date');
    console.log(`${String(index + 1).padStart(2)}. [${date}] ${from}\n    ${subject}`);

    if (index < MAX_SAMPLES) {
      const body = extractBody(full.data.payload);
      const file = `${OUT_DIR}/sample-${index + 1}.txt`;
      writeFileSync(file, `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${body}`, 'utf8');
      console.log(`    → 本文を保存: ${file}`);
    }
  }
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '(なし)';
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '(本文なし)';
  if ((payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') && payload.body?.data) {
    const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    return payload.mimeType === 'text/html' ? `[HTML]\n${text}` : text;
  }
  for (const part of payload.parts ?? []) {
    const found = extractBody(part);
    if (found !== '(本文なし)') return found;
  }
  return '(本文なし)';
}

main().catch((error) => {
  console.error('失敗:', error);
  process.exit(1);
});
