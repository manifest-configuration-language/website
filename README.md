# MCL Webサイト

チュートリアル、言語リファレンス、標準ライブラリ、言語仕様、Playgroundを管理します。公開サイトは[https://mcl.walnuts.dev/](https://mcl.walnuts.dev/)です。ドキュメントは`src/content/docs/`で直接編集します。

## ローカル開発

Node.jsとpnpmは`mise.toml`に記載したバージョンを使用します。

```sh
mise run install
mise run dev
```

`@manifest-configuration-language/browser`の固定バージョンがPlaygroundのWASMと対応する`wasm_exec.js`を供給します。`@manifest-configuration-language/language`はTextMate GrammarとCodeMirror LanguageSupportを提供します。依存バージョンは`package.json`と`pnpm-lock.yaml`で管理し、Renovateのnpm更新で追従します。ビルドではアセットを事前圧縮せず、Caddyが`Accept-Encoding`に応じてzstdまたはgzipでオンザフライ圧縮します。

WebsiteのビルドではMCLのGoソースを取得せず、Goコンパイラも使いません。

Playgroundとドキュメントのサンプルは`src/content/docs/examples/`で管理します。`main.mcl`がある各ディレクトリをPlaygroundから開けます。

Playgroundは`Uint8Array.prototype.toBase64()`と`Uint8Array.fromBase64()`を実装するBaseline 2025対応ブラウザーを対象とします。

## Docker

```sh
docker build -t mcl-website:latest .
docker run --rm -p 8080:8080 mcl-website:latest
```

`http://localhost:8080/`でサイトを開きます。Caddyは静的ファイルを非rootで配信し、Playgroundは初回操作時にBrowser SDKのWorkerとWASMを読み込みます。Caddyはクライアントが対応する場合にzstd、gzip、非圧縮のいずれかで応答します。

## コンテナイメージ

`main`へのpushで`ghcr.io/manifest-configuration-language/website:main`と互換用の`latest`タグを更新します。`v*`タグでは同じタグ名のイメージもpushします。デプロイで同じイメージを固定する場合は、タグとBuildxが出力するdigestを組み合わせます。

```text
ghcr.io/manifest-configuration-language/website:main@sha256:<digest>
```

digestはGitHub ActionsのWebsiteワークフロー実行サマリーに表示されます。digest指定のイメージ参照はタグの更新後も同じイメージを指します。現在は組織ポリシーでパッケージのPublic化が無効です。管理者が組織のPackages設定でPublic化を許可した後、`website`パッケージの可視性をPublicにすると認証なしでpullできます。
