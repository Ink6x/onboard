# onboard — Lancers 半自律応募システム

[![CI](https://github.com/Ink6x/onboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Ink6x/onboard/actions/workflows/ci.yml)

Lancersのおすすめ案件通知メールをGmailから収集し、ポートフォリオをもとにAIが提案文を生成、Telegramで承認・編集してから応募するシステム。

```
Gmail(通知メール) → パース → SQLite(正) → スコアリング → 提案文生成(Claude)
                                                    ↓
Notion(応募管理DB) ←── 投影 ──── Telegram承認 [✅承認 / ✏️編集 / ⏭スキップ]
```

設計原則: **AIは生成、実行(応募)は人間の承認を必ず経る。全遷移を監査ログに記録。**

## セットアップ

```powershell
npm install
copy .env.example .env   # 値を埋める(下記)
```

### 1. Telegram ボット
1. [@BotFather](https://t.me/BotFather) で `/newbot` → トークンを `TELEGRAM_BOT_TOKEN` へ
2. 作ったボットに何かメッセージを送り、`https://api.telegram.org/bot<TOKEN>/getUpdates` で自分の `chat.id` を確認 → `TELEGRAM_CHAT_ID` へ

### 2. Claude API
- [console.anthropic.com](https://console.anthropic.com/) でAPIキー → `ANTHROPIC_API_KEY`

### 3. Notion(任意。未設定なら投影スキップ)
1. [notion.so/my-integrations](https://www.notion.so/my-integrations) でintegration作成 → `NOTION_TOKEN`
2. 親ページをintegrationに共有し、ページIDを `NOTION_PARENT_PAGE_ID` へ
3. `npm run notion:setup` → 出力された `NOTION_DATABASE_ID` を .env へ

### 4. Gmail(任意。未設定ならポーリング無効)
1. GCPコンソールでプロジェクト作成 → Gmail API有効化 → OAuthクライアント(デスクトップ)作成
2. `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` を設定
3. `npm run gmail:auth` → **Lancers通知が届くアカウント**で認可 → `GMAIL_REFRESH_TOKEN` を .env へ

## 動かす

```powershell
npm run e2e:dummy   # ダミー案件で 生成→Telegramカード まで疎通確認
npm run dev         # 常駐(ポーリング+承認ボット)
npm test            # ユニットテスト
```

## 運用フロー

1. 通知メールから新着案件を自動登録(URLで冪等)
2. 案件詳細ページから依頼概要・提案数を取得 → 適合スコアで3ティアに振り分け
   - `FULL_AUTO_SCORE` 以上: 提案文を自動生成してTelegramへ承認カード送信
   - `LIGHT_NOTIFY_SCORE` 以上: ライトカードのみ通知。「✍️興味あり」を押すと生成(トークン節約)
   - 未満: 自動スキップ(Notionには記録)
3. (フル自動ティアまたは興味あり押下後)提案文を生成してTelegramへ承認カード送信
4. ✏️編集 → 修正指示を返信すると再生成して再確認(「差し替え:」で直接差し替えも可)
5. ✅承認 → 送信モードにより分岐(下記)
6. 受注・返信などのクライアント反応はNotion上で手動更新

### 送信モード

`.env` の `SUBMIT_MODE` で切り替え:

**`manual`(既定・安全)**
承認すると案件URLが届くので、ブラウザで開いて最新提案文を貼り付けて応募 → 「🚀送信済みにする」で記録。

**`auto`(Playwright自動送信・2段階確認)**
承認すると Playwright がログイン済みセッションで提案フォームに自動入力(提案文・希望金額・納期)→ **入力済み画面のスクショをTelegramへ送信** → 「🚀 本当に送信」を押して初めて実送信。「✋ 中止」で取りやめ可。送信は不可逆なので、必ずスクショを確認してから送信ボタンを押すこと。

#### auto モードのセットアップ

```powershell
# 1. 初回ログイン(ヘッド付きブラウザが開く。2FAまで完了させてEnter)
npm run lancers:login

# 2. 提案フォームのセレクタ確認(任意の案件URLで。送信はしない)
npm run lancers:calibrate -- https://www.lancers.jp/work/detail/<id>
#    → ❌が出たら src/submitter/selectors.ts を修正

# 3. Notion DBに送信記録カラムを追加(既存DB利用時のみ・初回1回)
npm run notion:migrate

# 4. .env で SUBMIT_MODE=auto に変更して再起動
npm run dev
```

送信の安全ガード(すべて `.env` で調整可):
- 日次上限 `MAX_APPLICATIONS_PER_DAY`(既定3)
- 営業時間内のみ `SUBMIT_HOURS_START`〜`SUBMIT_HOURS_END`(既定9〜22時)
- 送信前ランダム遅延 `SUBMIT_DELAY_MIN_SEC`〜`MAX_SEC`
- 希望金額は `profile.yaml` の `bidding`(既定: 予算上限×90%)
- 全送信のスクショを `SCREENSHOT_DIR` に保存し、Notionの「送信結果」「スクショパス」に記録

> ⚠️ 自動送信はLancers利用規約上のリスクがあります(33条)。2段階確認・日次上限・人間承認で緩和していますが、アカウント停止リスクはゼロではありません。

## 設計メモ

- **正(source of truth)**: パイプライン状態はSQLite。Notionは人間向けの投影(一方向同期)
- **profile.yaml**: 提案文生成の入力(自動生成物・手編集禁止)。人物・実績の正は `portfolio/knowledge-base/`、営業設定(skills/categories/NG語/conditions/bidding)の正は `sales.yaml`。`npm run profile:sync` で KB→LLM変換(匿名化)→禁止語スキャン(fail-closed)→diff承認 を経て再生成する。`npm run profile:check` でKBとの鮮度照合(起動時にも自動警告)
- **提案文ロジック**: `src/generator/` のinterface越しに差し替え可能。v1はLancersベストプラクティス(7パーツ構成・300〜500字・数値実績・案件名を冒頭に)を織り込んだClaude呼び出し+自己検査
- **メールパーサー**: 実フォーマット未入手のため汎用ヒューリスティック。実メール入手後に `tests/parser.test.ts` のフィクスチャを差し替えて精度を上げる
- **Phase 4(未実装)**: `SUBMIT_MODE=auto` でのPlaywright自動送信。規約リスク(利用規約33条)を理解の上で導入する。レート制限(`MAX_APPLICATIONS_PER_DAY`)・営業時間内送信・証跡スクショを必須とする
