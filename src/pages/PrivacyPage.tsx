import zhTWCopy from '../content/zh-TW.json';

const updatedAt = '2026 年 8 月 2 日';
const privacyOpeningCopy = zhTWCopy.author.privacyOpening;

export const PrivacyPage = () => <div className="content-page privacy-page">
  <header>
    <p className="eyebrow">隱私與資料</p>
    <h1>實際保存什麼，以及為什麼</h1>
    <p className="muted">最後更新：{updatedAt}。本頁依目前網站與資料庫的實際行為編寫。</p>
  </header>

  <section>
    <h2>{privacyOpeningCopy.title}</h2>
    <p>{privacyOpeningCopy.currentVersion}</p>
    <p><strong>{privacyOpeningCopy.signedOutLabel}</strong>{privacyOpeningCopy.signedOut}</p>
    <p><strong>{privacyOpeningCopy.signedInLabel}</strong>{privacyOpeningCopy.signedIn}</p>
    <p>{privacyOpeningCopy.benefitsIntroduction}</p>
    <ol>
      {privacyOpeningCopy.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
    </ol>
    <p>{privacyOpeningCopy.dailyViews}</p>
    <p><strong>{privacyOpeningCopy.editorLabel}</strong>{privacyOpeningCopy.editor}</p>
    <p>{privacyOpeningCopy.reviewer}</p>
    <p>{privacyOpeningCopy.limits}</p>
    <p>{privacyOpeningCopy.application}</p>
    <p>{privacyOpeningCopy.blogger}</p>
    <p>{privacyOpeningCopy.publicGood}</p>
    <p>{privacyOpeningCopy.publicNickname}</p>
    <p className="muted">{privacyOpeningCopy.reminder}</p>
    <hr />
    <p className="muted">{privacyOpeningCopy.technicalIntroduction}</p>
  </section>

  <section>
    <h2>個人資料告知事項</h2>
    <p><strong>資料蒐集者／本站經營者：</strong>黃紹東</p>
    <p><strong>個資聯絡方式：</strong><a href="mailto:louieddxu2@gmail.com">louieddxu2@gmail.com</a></p>

    <h3>蒐集目的</h3>
    <ul>
      <li>Google 登入、帳號識別、Session 與權限管理</li>
      <li>提供遊戲列表、收藏、已讀版本、投票、投稿、修訂及審核功能</li>
      <li>產生不連結帳號的遊戲瀏覽彙總統計</li>
      <li>網站安全、防止濫用、維運與故障排查</li>
    </ul>

    <h3>個人資料類別</h3>
    <ul>
      <li>Google 帳號識別碼、電子信箱雜湊識別值與遮罩顯示值、Google 名稱與頭像</li>
      <li>帳號角色、權限、Session 與登入時間</li>
      <li>收藏、已讀版本、投票及投稿活動</li>
      <li>投稿、修訂、審核，以及使用者選擇公開的暱稱</li>
      <li>瀏覽器、裝置、網路連線與安全維運所需的技術資訊</li>
    </ul>

    <h3>利用期間、地區、對象及方式</h3>
    <ul>
      <li><strong>期間：</strong>依本頁各資料類型所列期限；帳號資料通常保留至帳號刪除，已發布內容與修訂紀錄可能在匿名化後長期保留。</li>
      <li><strong>地區：</strong>使用者所在地，以及 Google、Cloudflare 實際提供、處理與備援服務的地區，可能涉及跨境處理；本站不保證資料固定儲存於台灣。</li>
      <li><strong>對象：</strong>本站經營者、Google、Cloudflare；公開投稿及公開暱稱標示也會提供一般訪客閱讀。</li>
      <li><strong>方式：</strong>以自動化電子方式進行驗證、保存、同步、公開顯示、彙總統計、安全防護及故障排查。</li>
    </ul>

    <h3>你的權利與申請方式</h3>
    <p>你可以申請查詢或閱覽、取得複製本、補充或更正、停止蒐集、處理或利用，以及刪除個人資料。</p>
    <p>請寄信至 <a href="mailto:louieddxu2@gmail.com">louieddxu2@gmail.com</a>，說明申請項目與本站帳號；為避免他人冒用，本站可能要求你完成必要的身分確認。本站會在法定期間內處理並回覆。</p>
    <p>本站提供在遊戲頁取消收藏、在規則卡片撤回投票，以及在帳號頁清除全部收藏或永久刪除帳號等自助功能。已發布規則與共同修訂內容，可能在依法或維持共同編輯成果所必要的範圍內匿名化保留。</p>

    <h3>不提供資料的影響</h3>
    <p>若不提供 Google 登入所需資料，仍可搜尋遊戲並閱讀公開規則，但無法使用遊戲列表、收藏、投票、投稿及其他登入功能。</p>
  </section>

  <section>
    <h2>編輯者與管理員邀請</h2>
    <p>管理員準備授予 Editor 或 Admin 權限時，會由管理員輸入受邀者的 Google 信箱；這些資料不是直接向受邀者蒐集。</p>
    <p>本站會保存：</p>
    <ul>
      <li>電子信箱的雜湊識別值與遮罩顯示值</li>
      <li>預計授予的角色</li>
      <li>管理員填寫的授權備註</li>
      <li>邀請、接受及撤銷狀態與時間</li>
    </ul>
    <p>這些資料用於核對受邀帳號、授予權限及保留授權稽核紀錄。邀請接受或撤銷後，目前不會自動刪除；受邀者可以透過本頁聯絡方式申請查詢、更正或刪除，本站會依權限管理及稽核所需範圍處理。</p>
  </section>

  <section>
    <h2>不用登入也能閱讀</h2>
    <p>任何人都能搜尋遊戲並閱讀已發布的規則。</p>
    <p>公開頁面可能顯示遊戲名稱與別名、規則內容、分類、Tag、適用人數與版本、參考來源，以及選擇公開暱稱的建立者、修改者或審核者。</p>
    <p>未登入閱讀不會建立本站的個人瀏覽歷史，也不會計入首頁的遊戲瀏覽統計。</p>
    <p>Cloudflare 作為網站執行與安全防護供應商，仍會處理建立網路連線所需的 IP 位址、請求時間、瀏覽器與裝置技術資訊及其他技術性記錄。</p>
  </section>

  <section>
    <h2>登入帳號</h2>
    <p>本站使用 Google 登入驗證身分。</p>
    <p>登入時，本站會保存：</p>
    <ul>
      <li>Google 帳號識別碼</li>
      <li>已驗證電子信箱的雜湊識別值與遮罩顯示值；本站不保存完整電子信箱</li>
      <li>Google 提供的名稱</li>
      <li>Google 提供的頭像</li>
      <li>帳號建立時間</li>
      <li>最後登入時間</li>
      <li>本站角色與權限</li>
    </ul>
    <p>本站不會要求存取 Gmail、Google Drive、聯絡人、日曆或試算表等額外服務。</p>
    <p>網站登入 session 最長維持 30 天。伺服器不直接保存可供登入使用的 session token，只保存 token 的雜湊值。</p>
    <p>登出時會移除目前使用中的 session。已過期的 session 也會由每日排程清除。</p>
    <p>特定整合或短期驗證功能使用的 session 最長維持 1 小時。</p>
  </section>

  <section>
    <h2>遊戲瀏覽統計</h2>
    <p>只有登入後開啟遊戲頁，才會送出一次瀏覽計數。</p>
    <p>這項統計不會保存：</p>
    <ul>
      <li>帳號 ID</li>
      <li>Google 帳號資料</li>
      <li>電子信箱</li>
      <li>規則 ID</li>
      <li>個人的逐次瀏覽清單</li>
      <li>哪個帳號看過哪些遊戲的紀錄</li>
    </ul>
    <p>瀏覽器會收到一個隨機產生、設為 HttpOnly，並在下一個 UTC 日期到來時到期的 Cookie。</p>
    <p>伺服器會利用這個 Cookie 和遊戲 ID 產生當日的去重碼。因此，同一瀏覽器在同一個 UTC 日期內重複開啟或重新整理同一款遊戲，通常只會計算一次。</p>
    <p>這個數字是依瀏覽器去重後的瀏覽統計，不等同於精確的真人數。同一人使用不同瀏覽器或裝置時可能被分開計算，多人共用同一瀏覽器時也可能只計算一次。</p>
    <p>每日去重碼通常會在建立後 24 至 48 小時內，由每日排程清除。</p>
    <p>網站另外保存每款遊戲的每日彙總資料，包括：</p>
    <ul>
      <li>遊戲</li>
      <li>UTC 日期</li>
      <li>當日總數</li>
      <li>最後計數時間</li>
    </ul>
    <p>彙總資料保留最近 14 個 UTC 日期。</p>
    <p>這項統計只用來顯示近期哪些遊戲較常被開啟，作為首頁探索遊戲的依據，不用來建立個人的閱讀習慣或瀏覽檔案。</p>
  </section>

  <section>
    <h2>收藏</h2>
    <p>登入後收藏遊戲時，本站會保存：</p>
    <ul>
      <li>帳號</li>
      <li>遊戲</li>
      <li>收藏時間</li>
      <li>該遊戲最後已讀的公開規則版本</li>
    </ul>
    <p>這些資料用來顯示你的收藏，並判斷收藏後是否出現新的公開規則版本。</p>
    <p>取消單一收藏，或在帳號頁清除全部收藏時，相關收藏資料會刪除。</p>
  </section>

  <section>
    <h2>「重要！／我也玩錯過」投票</h2>
    <p>按下規則上的「重要！／我也玩錯過」時，本站會保存帳號與該規則之間的對應關係。</p>
    <p>保存這項資料是為了：</p>
    <ul>
      <li>防止同一帳號對同一規則重複計票</li>
      <li>顯示本人是否已經投票</li>
      <li>讓使用者之後撤回投票</li>
    </ul>
    <p>公開頁面只會顯示每則規則的總票數，不會公開投票者名單。</p>
    <p>這項資料是使用者主動提供的計票資料，不是收藏，也不會根據瀏覽行為自動推測。</p>
    <p>下列情況會移除投票對應資料：</p>
    <ul>
      <li>使用者再次按下按鈕撤回投票</li>
      <li>使用者刪除帳號</li>
      <li>該規則被永久刪除</li>
    </ul>
  </section>

  <section>
    <h2>保存在目前裝置上的資料</h2>
    <p>網站會使用瀏覽器的 IndexedDB 或其他瀏覽器儲存空間，在目前裝置保存部分資料，以減少重複下載並支援暫存功能。</p>
    <p>可能保存的內容包括：</p>
    <ul>
      <li>遊戲目錄</li>
      <li>Tag 目錄</li>
      <li>曾載入的公開規則</li>
      <li>最近查看的遊戲</li>
      <li>尚未送出的草稿</li>
      <li>等待同步的投稿</li>
      <li>本人近期的投票狀態</li>
      <li>首頁顯示模式</li>
      <li>當日是否已送出某款遊戲的瀏覽計數</li>
    </ul>
    <p>遊戲規則通常在一小時內直接使用本機資料，Tag 實體資料最長可能保存 24 小時，本人投票清單最長暫存 10 分鐘。</p>
    <p>公共 Tag 與遊戲總表會透過週期性快照與版本差額更新。</p>
    <p>上述期限主要是重新檢查或更新資料的快取期限，不代表期限一到，瀏覽器一定會立即刪除該筆資料。</p>
    <p>這些裝置資料只存在目前使用的瀏覽器，不會因登入而自動同步到其他裝置。</p>
    <p>使用者可以透過瀏覽器的網站資料設定清除這些內容。清除網站資料時，尚未同步的草稿或投稿也可能一併消失。</p>
  </section>

  <section>
    <h2>投稿與修訂</h2>
    <p>投稿時，本站可能保存：</p>
    <ul>
      <li>規則內容</li>
      <li>所屬遊戲</li>
      <li>建立者</li>
      <li>參考來源</li>
      <li>建立及更新時間</li>
      <li>審核狀態、審核者及審核時間</li>
    </ul>
    <p>規則被修改時，本站可能保存：</p>
    <ul>
      <li>修改前的內容</li>
      <li>修改後的內容</li>
      <li>修改者</li>
      <li>修改理由</li>
      <li>修改時間</li>
    </ul>
    <p>保存修訂紀錄是為了校稿、權限追蹤、處理誤改及在必要時復原舊版本。</p>
    <p>一般登入帳號提交的規則及新遊戲會立即公開，並標示為未審核；Editor 或 Admin 完成審核後，可能公開顯示審核者的暱稱。</p>
    <p>本站以帳號識別一般使用者目前尚未審核的投稿數量，用於執行規則與新遊戲的投稿額度。一般投稿者的帳號識別不會公開顯示在規則卡片上。</p>
    <p>已發布的規則及修訂紀錄屬於網站的長期編輯資料。</p>
    <p>隱藏規則目前採用軟刪除方式。一般使用者無法看到，但管理員仍可在必要時復原。</p>
    <p>帳號及其編輯紀錄不會只因長時間未登入而自動刪除。</p>
  </section>

  <section>
    <h2>公開暱稱與權限</h2>
    <p>只有 Editor 或 Admin 可以設定規則卡片使用的公開暱稱。</p>
    <p>即使具有這些權限，也必須自行開啟顯示暱稱，暱稱才會用於公開頁面的建立、修改或審核標示。</p>
    <p>一般登入帳號不會在規則建立或修改紀錄中公開顯示身分。</p>
    <p>一般使用者也不能讀取：</p>
    <ul>
      <li>他人的草稿</li>
      <li>隱藏規則</li>
      <li>管理資料</li>
      <li>未公開的修訂內容</li>
    </ul>
  </section>

  <section>
    <h2>使用者提供內容的著作權</h2>
    <p>本站不會因為使用者提交規則內容，就取得該內容的著作權。</p>
    <p>使用者自行撰寫且受到著作權保護的內容，其著作權仍屬於原作者。</p>
    <p>為了維持網站功能，使用者提交並發布內容時，同意本站保存、公開顯示、整理、編輯、保留修訂紀錄，以及在本站相關功能中使用該內容。</p>
    <p>這項同意不代表著作權轉讓給本站。</p>
    <p>使用者應確認自己有權提供所提交的內容，不應直接大量抄錄規則書、文章、翻譯或其他受到著作權保護的內容。</p>
    <p>若規則內容整理自外部來源，應盡量標示參考來源，並以整理容易玩錯、容易忽略或值得提醒的規則重點為主，而不是重製完整規則書。</p>
    <p>本站將已發布的規則記錄視為可長期累積與共同使用的公開內容，但「公共財」是網站理念上的說法，不代表任何人目前已經取得任意重製、重新散布、修改或商業使用全部資料的權利。</p>
    <p>若未來提供整批資料下載，本站會另外說明下載內容的使用範圍、授權方式及必要限制。</p>
  </section>

  <section>
    <h2>外部服務與廣告</h2>
    <p>Google 提供登入驗證。</p>
    <p>Cloudflare 提供：</p>
    <ul>
      <li>網站執行</li>
      <li>D1 資料庫</li>
      <li>快取</li>
      <li>安全防護</li>
      <li>技術性記錄及故障排查</li>
    </ul>
    <p>本站目前沒有使用：</p>
    <ul>
      <li>第三方廣告服務</li>
      <li>第三方行為分析服務</li>
      <li>跨站追蹤</li>
      <li>Gmail 整合</li>
      <li>Google Drive 整合</li>
      <li>Google 聯絡人整合</li>
      <li>Google 日曆整合</li>
    </ul>
    <p>網站目前保留廣告欄位，但尚未啟用第三方廣告。</p>
    <p>此網頁未來也不會新增其他營利介面。</p>
    <p>如果日後啟用廣告服務、新的第三方服務或新的資料用途，本頁會在相關功能上線時同步更新。</p>
  </section>

  <section>
    <h2>清除與更正</h2>
    <p>使用者可以：</p>
    <ul>
      <li>在遊戲頁取消單一收藏</li>
      <li>在帳號頁清除全部收藏</li>
      <li>再次按下規則投票按鈕以撤回投票</li>
      <li>透過瀏覽器設定清除本機快取、最近查看、草稿及待同步資料</li>
      <li>永久刪除本站帳號</li>
    </ul>
    <p>清除瀏覽器資料只會影響目前裝置上的本機資料，不會自動刪除已經送到伺服器的帳號、收藏、投票或已發布內容。</p>
  </section>

  <section>
    <h2>刪除帳號後會發生什麼事</h2>
    <p>刪除帳號時，本站會移除與個人帳號直接相關的資料，包括：</p>
    <ul>
      <li>Google 帳號識別碼</li>
      <li>電子信箱</li>
      <li>名稱</li>
      <li>頭像</li>
      <li>登入 session</li>
      <li>角色與權限</li>
      <li>收藏</li>
      <li>投票對應資料</li>
    </ul>
    <p>使用者建立或修改過的已發布規則及修訂紀錄，預設不會一起刪除。</p>
    <p>這些內容會繼續保留在網站中，原建立者或修改者則改為共用的「已刪除帳號」。</p>
    <p>本站不會替每一位刪除帳號的使用者，各自建立一個永久保留的匿名帳號。</p>
    <p>確認刪除帳號時，使用者可以另外選擇刪除符合以下條件的規則：</p>
    <ul>
      <li>由本人建立</li>
      <li>尚未經過其他人修改</li>
    </ul>
    <p>只要規則曾經由其他人共同修改，就不會被這個選項刪除，以免一併移除其他人的編輯成果及修訂歷史。</p>
  </section>
</div>;
