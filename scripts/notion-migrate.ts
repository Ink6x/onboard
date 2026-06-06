/**
 * 既存のNotion応募管理DBに、Phase 4で追加した送信記録プロパティを追加する。
 * (databases.update は不足プロパティの追加に使える。既存プロパティはそのまま)
 *
 * 使い方: npm run notion:migrate
 */
import 'dotenv/config';
import { Client } from '@notionhq/client';
import { STATUS_LABELS } from '../src/projection/notion.js';

const MANUAL_STATUSES = ['返信あり', '受注', '不採用'] as const;

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) {
    throw new Error('NOTION_TOKEN と NOTION_DATABASE_ID を .env に設定してください');
  }

  const notion = new Client({ auth: token });
  const statusOptions = [
    ...Object.values(STATUS_LABELS).map((name) => ({ name })),
    ...MANUAL_STATUSES.map((name) => ({ name })),
  ];

  await notion.databases.update({
    database_id: databaseId,
    properties: {
      // 既存のselectに新ステータス「送信確認待ち」を追加
      ステータス: { select: { options: statusOptions } },
      希望金額: { number: { format: 'yen' } },
      提示納期: { rich_text: {} },
      送信結果: { rich_text: {} },
      スクショパス: { rich_text: {} },
    },
  });

  console.log('✅ Notion DBに送信記録プロパティを追加しました');
}

main().catch((error) => {
  console.error('❌ 失敗:', error);
  process.exit(1);
});
