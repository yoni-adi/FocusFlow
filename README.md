FocusFlow オンライン専用パッケージ（広告/SEO/PWA）
===============================================
1) /public に以下3つのアイコンを置いてあります（差し替え可）
   - icon-192.png
   - icon-512.png
   - apple-touch-icon.png

2) ルート index.html をサーバーのドキュメントルートに配置。
   - GA4 の測定ID (G-XXXXXXX) を実IDへ
   - AdSense client id (ca-pub-XXXXXXXXXXXXXXX) を実IDへ
   - og:url, canonical, robots.txt のドメインを置換

3) SPA本体（Vite等）は /src/main.jsx をエントリに想定。既存プロジェクトにこの index.html を上書きしてOK。

4) オンライン専用。Service Worker は不要です。
