# MCL Webサイト

チュートリアル、言語リファレンス、標準ライブラリ、言語仕様、Playgroundを管理します。公開サイトは[https://mcl.walnuts.dev/](https://mcl.walnuts.dev/)です。

## ローカル開発

```sh
mise run install
mise run dev
```

## WASMランタイム

`public/mcl.wasm.gz`と`public/wasm_exec.js`はMCLコアの同名バージョンから生成します。リポジトリルートでMCLコアをチェックアウトし、`mise run website:wasm:update`を実行すると、Playground用のランタイムを更新できます。

Playgroundの構文ハイライトはVS Code拡張のGrammarを使います。拡張リポジトリを隣にチェックアウトし、`mise run website:grammar:update`を実行すると同期できます。

## Docker

```sh
docker build -t mcl-website:latest .
docker run --rm -p 8080:8080 mcl-website:latest
```

`http://localhost:8080/`でサイトを開きます。Nginxは静的ファイルを配信し、Playgroundは初回操作時にWorkerと圧縮WASMを読み込みます。

## コンテナイメージ

`main`へのpushで`ghcr.io/manifest-configuration-language/website:latest`をビルドしてpushします。`v*`タグでは同じタグ名のイメージもpushします。現在は組織ポリシーでパッケージのPublic化が無効です。管理者が組織のPackages設定でPublic化を許可した後、`website`パッケージの可視性をPublicにすると認証なしでpullできます。
