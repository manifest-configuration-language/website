---
title: "依存ファイル"
sidebar:
  order: 4
---

MCLプロジェクト内で共有する定義は、相対パスのモジュールに分けて`import`します。公開する定義には`export`を付けます。

```mcl verify fixture=modules-container expect=0.name=api
import "./components/container.mcl" as defaults

let container = defaults.container with:
  name: "api"

emit container
```

モジュール内に`emit`や`validate`は置かず、出力と検証はエントリーファイルに記述します。import先はプロジェクトルート内に限定されます。最寄りの`mcl.toml`がルートを決め、設定ファイルがない場合はエントリーファイルのディレクトリがルートになります。

Manifest、JSON Schema、Helm Chart、固定commitのGit sourceなど外部データを参照するときは、`mcl update`で取得し、生成された`mcl.lock`の差分を確認します。通常の評価はlockとコンテンツキャッシュを照合するため、外部ネットワークへ接続しません。依存を追加または更新するときは、lockに記録されたdigestと取得元をレビューしてください。

詳しくは[モジュール](../reference/modules/)、[Adapter関数](../reference/functions/)、[CLIの依存更新](../reference/cli/#update)を参照してください。
