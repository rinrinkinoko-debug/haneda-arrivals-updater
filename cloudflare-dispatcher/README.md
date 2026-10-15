# 外部定期起動の導入と検証

## 2026-10-15 の状態
- GitHub通常更新: 毎時08・28・48分に再登録済み。
- GitHubバックアップ: 毎時18・38・58分に再登録済み。
- このディレクトリは準備済みコードです。Cloudflareへの配備・秘密情報設定・外部起動の成功は未確認です。
- 外部タイマーは毎10分に通常更新workflowを起動します。取得処理とSiteへのGitHub OIDC認証は既存のままです。

## 必要な接続
1. 使用するCloudflareアカウントのWorkers配備権限。
2. このリポジトリだけを対象にしたGitHub fine-grained PAT: Actions Read and write。期限を設定し更新管理すること。
3. GITHUB_TOKENはCloudflare Workerのsecretに保存します。公開リポジトリ・設定ファイル・チャットへ貼り付けないでください。
ChatGPTのGitHub接続は、このWorkerが利用できるトークンを提供するものではありません。

## 配備
Cloudflareにログイン済みの環境で、このディレクトリから実施します。
```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
```
secret入力は対話プロンプトで行います。配備とsecret設定の間に実行されたCronは失敗する場合があります。secret設定後、Cloudflare上のCronとログを確認します。
既存名のWorkerがある場合は、先にその配備状況とsecret名を確認し、同じWorkerを更新します。

## 検証
```sh
node --test worker.test.mjs
npx wrangler tail
```
- Cloudflareで予定時刻とdispatch_acceptedまたはskipped_active_runを確認。
- GitHubでevent=workflow_dispatch、mainの新規runが作成され、successとなることを確認。
- SiteのD1 DB.arrivalsで、日本時間の本日・翌日それぞれdom/intlの4行を読み、起動前よりupdated_atが進んだことを確認。
- dispatch_acceptedはAPI受付のみを意味し、DB更新成功を意味しません。WorkerのHTTP応答もデータの正常性を保証しません。
- 24〜48時間のDB更新間隔を測り、外部起動とGitHub scheduleの両方が継続するか判定します。
- 認証不備・GitHub API障害時はその実行を失敗として記録し、次のCronで再評価します。受付が不明なPOSTの即時再試行はしません。
- 実行中ジョブを検出した場合は追加起動を省略します。同時呼び出し間の厳密なロックではなく、最終的な直列化は既存workflowのconcurrencyが担当します。
- 最新10件の通常更新履歴を確認する軽量な保護です。長時間待機・大量起動時は履歴を追加調査してください。

## 切り戻し
外部起動に問題があればCloudflare側のこのWorkerのCronだけを停止し、GitHub scheduleと既存の60分監視を維持します。GitHub起動を止めないでください。

公式資料:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
