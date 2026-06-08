# SubsTrack Notifications Worker

Cloudflare Worker + D1 + Cron Triggerで、ホーム画面に追加したSubsTrack PWAへWeb Push通知を送信します。

## 保存するデータ

- Push購読情報
- ランダムな端末IDと端末トークンのハッシュ
- タイムゾーン、通知時刻
- 項目ID、表示名、表示金額、更新日・期限日、周期、通知日

ライセンスキー、メモ、カード情報は送信しません。

## セットアップ

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create substracker-notifications`
4. 返されたDatabase IDを`wrangler.toml`へ設定
5. VAPID鍵を生成
6. `VAPID_PUBLIC_KEY`と`VAPID_PRIVATE_KEY`をWrangler Secretへ登録
7. `VAPID_SUBJECT`を有効な連絡先へ変更
8. `npm run db:remote`
9. `npm run deploy`
10. Worker URLをルートの`push-config.js`へ設定

## VAPID鍵

```powershell
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

## テスト

```powershell
npm test
```
