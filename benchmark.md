# SSG試作の比較

同じ`docs/`原本から生成した言語リファレンスとプレイグラウンドの比較です。転送量はビルド後のHTMLが直接参照するJavaScriptとCSSを重複なしで合計しました。Astroでは`astro-island`が参照するReactコンポーネントとrenderer、その静的JavaScript importも含めています。RspressではHTMLのscript、JavaScript preload、stylesheetを集計しています。gzipサイズは各ファイルをgzip level 9で個別圧縮して合計しました。HTML、検索インデックス、遅延ロードされるPlayground WorkerとWASMは含めていません。これはHTML参照の静的集計であり、Rspress runtimeが後から要求する非同期chunkは含まれません。

| SSG | ページ | JavaScript raw / gzip | CSS raw / gzip |
| --- | --- | ---: | ---: |
| Rspress 2 | 言語リファレンス | 649.6 / 183.3 kB | 68.0 / 12.5 kB |
| Astro 6 + Starlight | 言語リファレンス | 10.4 / 5.0 kB | 85.2 / 15.7 kB |
| Rspress 2 | プレイグラウンド | 496.6 / 162.8 kB | 68.0 / 12.5 kB |
| Astro 6 + Starlight | プレイグラウンド | 681.3 / 219.9 kB | 67.0 / 11.8 kB |

測定スクリプトは`pnpm run build`と`pnpm run astro:build`の後に`node scripts/measure-build.mjs`を実行します。両方とも同じローカル環境で依存関係をインストール済みの状態から測りました。Rspress 2.0.23のbuild報告時間は0.26秒で、Astro 6.4.8のbuild報告時間は3.12秒でした。Rspressの時間はcontent sync後のSSG処理、Astroの時間はcontent sync後のSSGとPagefind処理です。

Astroは言語リファレンスの初回JavaScript量を大きく減らしました。プレイグラウンドではAstroがReactとCodeMirrorを初回表示時に読み込むため、RspressよりJavaScript量が多くなりました。本番ではReactベースのプレイグラウンドを既存ドキュメント内へ統合する要件に合わせ、レビュー0006の指定どおりRspress 2を採用します。

この比較試作は採用判断の材料であり、本番用の配信設定ではありません。
