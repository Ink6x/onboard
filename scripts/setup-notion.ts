/**
 * Notion「応募管理」データベースを NOTION_PARENT_PAGE_ID 配下に作成する。
 * 実行後、出力された database_id を .env の NOTION_DATABASE_ID に設定すること。
 *
 * 使い方: npm run notion:setup
 */
import 'dotenv/config';
import { Client } from '@notionhq/client';
import { STATUS_LABELS } from '../src/projection/notion.js';

const MANUAL_STATUSES = ['返信あり', '受注', '不採用'] as const; // 人間が手動更新する欄

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!token || !parentPageId) {
    throw new Error('NOTION_TOKEN と NOTION_PARENT_PAGE_ID を .env に設定してください');
  }

  const notion = new Client({ auth: token });
  const statusOptions = [
    ...Object.values(STATUS_LABELS).map((name) => ({ name })),
    ...MANUAL_STATUSES.map((name) => ({ name })),
  ];

  const database = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'Lancers応募管理' } }],
    properties: {
      案件名: { title: {} },
      案件URL: { url: {} },
      ステータス: { select: { options: statusOptions } },
      適合スコア: { number: {} },
      予算: { rich_text: {} },
      判定理由: { rich_text: {} },
      提案文: { rich_text: {} },
      応募日時: { date: {} },
      使用実績: { multi_select: { options: [] } },
      メモ: { rich_text: {} },
    },
  });

  console.log('✅ Notionデータベースを作成しました');
  console.log(`   NOTION_DATABASE_ID=${database.id}`);
  console.log('   この値を .env に追記してください');
}

main().catch((error) => {
  console.error('❌ 作成に失敗しました:', error);
  process.exit(1);
});
