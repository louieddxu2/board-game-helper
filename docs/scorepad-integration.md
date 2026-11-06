# 計分板整合方向

萬用桌遊計分板是獨立的 App，有自己的 Worker 與 D1，目前不呼叫本站。

## 現況

本站 API 只給本站自己的頁面使用：

- 跨網站讀取只回應本站來源（`APP_ORIGIN`）與本機開發用的 `TRUSTED_APP_ORIGINS`，其他網站在瀏覽器中無法讀寫。
- 登入只使用本站 cookie，不提供 Bearer token。
- 2026-11-06 已移除先前未使用的整合：公開讀取的 `Access-Control-Allow-Origin: *`、`/api/auth/google/exchange`、TypeScript client 與 OpenAPI 文件。

原因：

- 本站沒有自訂網域，無法使用 Cloudflare 的伺服器端快取，每個公開讀取請求都會查詢 D1。開放跨網站讀取，等於讓任何網站都能透過訪客的瀏覽器消耗本站的 D1 讀取量。
- 公開 API 仍可被程式直接呼叫；對 D1 用量的保護是每個 IP 的讀取頻率限制（`PUBLIC_RATE_LIMITER`）。

## 未來若計分板要讀取本站規則

1. **優先：Cloudflare Service Binding。** 兩個 Worker 在同一個 Cloudflare 帳號下時，讓計分板的 Worker 透過 Service Binding 直接呼叫本站 Worker。請求不經過公開網路，外部無法使用這條路徑，不需要金鑰，也不需要開放跨網站存取，用量只來自計分板。
2. **退而求其次：伺服器端金鑰。** 無法使用 Service Binding 時，發一把金鑰給計分板，存放在計分板 Worker 的 secrets，由它的伺服器端呼叫本站，並依金鑰限制用量。

不要：

- 重新對所有網站開放跨網站讀取（`Access-Control-Allow-Origin: *`）。
- 把金鑰放在計分板的瀏覽器端程式碼；任何人都能從網頁原始碼取得並冒用。
