---
title: "CLIのインストール"
sidebar:
  order: 1
---

## Goの準備

MCL CLIのインストールにはGoが必要です。利用する環境に対応したGoを[公式サイト](https://go.dev/doc/install)からインストールしてください。

## CLIのインストール

```sh
go install github.com/manifest-configuration-language/mcl/cmd/mcl@latest
```

`go install`は実行ファイルをGoの`GOBIN`へ配置します。`GOBIN`を設定していない場合は`GOPATH/bin`が使われるため、そのディレクトリを`PATH`に追加してください。

インストール後にバージョンを表示して確認します。

```sh
mcl version
```

次は[最初のManifest](./quickstart/)を作成します。
