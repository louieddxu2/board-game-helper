# 萬用桌遊計分板整合

萬用桌遊計分板可以直接讀取與新增「玩錯的桌遊規則」，並讓使用者延續同一個 Google 帳號。兩個 App 共用的是 Google 身分，不是 Google API 權限。

## 身分與授權

計分板目前取得的 Google access token 含有 `drive.file`，只供計分板操作使用者自己的 Drive 檔案。這個 token 不得傳給規則平台。

計分板應另外透過 Google Identity Services 的 `google.accounts.id` 取得 ID token：

```ts
google.accounts.id.initialize({
  client_id: GOOGLE_CLIENT_ID,
  auto_select: true,
  callback: async ({ credential }) => {
    await rulesClient.exchangeGoogleCredential(credential);
  },
});
google.accounts.id.prompt();
```

規則平台會驗證 ID token 的簽章、`aud`、`iss`、到期時間與 `email_verified`，以 Google `sub` 作為固定帳號 ID，再簽發一小時有效的規則平台 Bearer session。Bearer token 只保存在記憶體；重新開啟 App 或到期時，重新要求 GIS 恢復身分。瀏覽器與 FedCM 仍可能要求使用者確認一次，因此不可假設每次都能完全無畫面登入。

## 讀取流程

公開讀取不需要登入，也不攜帶 Bearer token，以便所有訪客共用 CDN 快取：

1. `GET /api/games/resolve?name=農家樂`：用計分板的遊戲名稱比對正式名稱或別名。
2. 找不到唯一結果時，以 `GET /api/games/search?q=農家樂` 顯示候選，讓使用者點選。
3. 計分板在自己的 IndexedDB 保存 `localGameId → rulesGameId` 映射。
4. `GET /api/games/{rulesGameId}`：讀取該遊戲的所有公開規則。

名稱已配對後不必再次搜尋，只有遊戲頁的公開 GET 請求。公開 API 回應可被 Cloudflare 邊緣快取。

### 完整離線快照

計分板也可呼叫 `GET /api/export/public`，一次下載全部公開遊戲、別名、規則、來源與 tag。這不是 D1 管理備份，不含使用者、私人備註、邀請、session、隱藏內容與修訂歷史。

回應具有長時間 CDN 快取和 `ETag`。計分板把快照與 ETag 存入 IndexedDB，下次帶上 `If-None-Match`：

- 資料未變：回傳 `304`，不重傳 JSON。
- 資料有變：下載新的完整快照並原子替換本機資料。
- 大多數訪客取得 Cloudflare 的同一份邊緣快取，不會各自掃描 D1。

資料量仍小時，完整快照是最簡單可靠的同步方式。日後壓縮後快照達數 MB，再增加增量端點；不需要現在先承擔刪除、衝突和游標同步的複雜度。

## 寫入流程

1. 計分板取得 Google ID token。
2. `POST /api/auth/google/exchange` 換取規則平台 Bearer session。
3. `POST /api/submissions`，標頭帶 `Authorization: Bearer ...`。
4. 每次提交產生固定 `idempotencyKey`；網路重試時沿用同一值，避免重複新增。
5. 目前只有 `editor` 或 `admin` 可以寫入。未來可由規則平台管理頁邀請其他 Google 信箱。

```ts
import { BoardGameRulesClient } from './board-game-rules-client';

const rulesClient = new BoardGameRulesClient({
  baseUrl: 'https://rules.example.com',
});

const resolved = await rulesClient.resolveGame(scorePadGameName);
if (resolved.game) {
  const detail = await rulesClient.game(resolved.game.id);
  // 在計分板顯示 detail.game.rules
}

await rulesClient.submit({
  gameId: rulesGameId,
  idempotencyKey: BoardGameRulesClient.createIdempotencyKey(),
  rules: [
    { statement: '本局發現的正確規則', commonMistake: '我們原本的玩法' },
  ],
});
```

## 跨站設定

正式上線前需要同步設定：

- Google OAuth Web Client 的 Authorized JavaScript origins 加入計分板與規則平台正式網域。
- 規則平台 `GOOGLE_CLIENT_ID` 使用與計分板相同的 Web Client ID；若日後分成多個 Client ID，放入逗號分隔的 `GOOGLE_CLIENT_IDS`。
- 規則平台 `TRUSTED_APP_ORIGINS` 加入計分板來源，例如 `https://score.example.com`；可列多個逗號分隔來源。
- 計分板只把規則平台短期 token 放在記憶體，不放入 `localStorage`、IndexedDB 或網址。
- 不在前端放永久 API key，也不將 Drive access token傳給規則平台。

跨站寫入只允許明列的 Origin；公開 GET 回應使用 `Access-Control-Allow-Origin: *`。跨站不共用 cookie，因此沒有第三方 cookie 相容性問題。

## 穩定契約

目前 `/api/*` 視為 API v1，回應含 `X-API-Version: 1`。破壞相容性的修改應另開 `/api/v2`；既有欄位只新增、不改名。介面定義另見 [OpenAPI](./openapi.yaml)。
