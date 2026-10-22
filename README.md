# MCL Webサイト

チュートリアル、言語リファレンス、標準ライブラリ、言語仕様、Playgroundを管理します。公開サイトは[https://mcl.walnuts.dev/](https://mcl.walnuts.dev/)です。ドキュメントは`src/content/docs/`で直接編集します。

## ローカル開発

Node.js、pnpm、Goは`mise.toml`に記載したバージョンを使用します。

```sh
mise run install
mise run dev
```

初回の開発起動とビルドでは、`mcl-runtime.json`で固定したMCL本体のコミットからWASMランタイムとドキュメント検証用CLIを生成し、`vscode-grammar.json`で固定したVS Code拡張のコミットから構文Grammarを取得します。2つの参照コミットはRenovateが更新します。WASMと`wasm_exec.js`は`src/playground/runtime/`へ出力され、Workerへ同梱するJavaScriptとフィンガープリント付きWASMアセットにビルドされます。CLIは`.build/bin/`へ出力されます。生成ファイルはGitで管理しません。

## Docker

```sh
docker build -t mcl-website:latest .
docker run --rm -p 8080:8080 mcl-website:latest
```

`http://localhost:8080/`でサイトを開きます。Nginxは静的ファイルを配信し、Playgroundは初回操作時にWorkerと圧縮WASMを読み込みます。

## コンテナイメージ

`main`へのpushで`ghcr.io/manifest-configuration-language/website:main`と互換用の`latest`タグを更新します。`v*`タグでは同じタグ名のイメージもpushします。デプロイで同じイメージを固定する場合は、タグとBuildxが出力するdigestを組み合わせます。

```text
ghcr.io/manifest-configuration-language/website:main@sha256:<digest>
```

digestはGitHub ActionsのWebsiteワークフロー実行サマリーに表示されます。digest指定のイメージ参照はタグの更新後も同じイメージを指します。現在は組織ポリシーでパッケージのPublic化が無効です。管理者が組織のPackages設定でPublic化を許可した後、`website`パッケージの可視性をPublicにすると認証なしでpullできます。
