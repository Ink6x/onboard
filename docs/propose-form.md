# Lancers提案フォームの構造(2026-06 ログイン状態で確認)

詳細ページの「提案する」→ `https://www.lancers.jp/work/propose_start/<id>?proposeReferer=` へ遷移。
フォーム本体はReact製(css-in-js + react-datepicker)。

## 確定セレクタ(src/submitter/selectors.ts)

| 役割 | セレクタ | 備考 |
|---|---|---|
| 提案文(必須) | `#ProposalDescription` | `textarea[name="data[Proposal][description]"]` |
| 契約金額(税抜) | `input[type="number"][step="1000"]:not([name])` | 主計画の金額。ProposalOption[N]はnameを持つので除外で一意 |
| 完了予定日(必須) | `.react-datepicker__input-container input` | フォーム内に1個のみ。形式依存(下記) |
| NDA同意 | `#ProposalIsAgreement` | `name="data[Proposal][is_agreement]"`。`disabled`は**クラス名**で属性ではない→force checkで操作可 |
| 送信 | `#form_end` | `input[name="send"]` value="同意して提案する" |

## 注意点

- **計画(タイトル/完了予定日/金額)はname属性が無い**Reactフィールド。`fill()`のinputイベントでReact stateは更新される。
- 計画タイトルは既定値「プロジェクトの完成」が入る→**触らない**(脆いハッシュclass回避)。
- 契約金額は既定値が入っているので、クリアしてから希望金額を入れる。
- **完了予定日のdateFormatが不明**。yyyy/MM/dd → MM/dd/yyyy → yyyy-MM-dd の順で適応入力し、valueが入った形式を採用。
- 追加オプション(`data[ProposalOption][N]`)は任意なので入力しない。
- 2段階確認(入力→スクショ→人間が送信ボタン)があるため、万一日付が未反映でも送信前に気づける。

## 検証状況

- **フォーム入力(fillステージ)は検証済み**(2026-06-06、案件5549226 / npm run lancers:testfill)。
  提案文・契約金額・完了予定日(react-datepicker、yyyy/MM/dd形式で反映)・計画タイトル既定値、
  いずれも正しく入力された。NDA欄が無い案件では正しくスキップ。
- **最終送信(submitボタンのクリック→成功判定)は未検証**。
  実際にクライアントへ応募が飛ぶため、最初の1件は SUBMIT_MODE=auto で
  Telegramの入力済みスクショを目視し、本当に応募してよい案件でのみ「🚀本当に送信」を押すこと。
