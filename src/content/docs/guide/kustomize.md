---
title: "Kustomize"
sidebar:
  order: 3
---

`kustomize.build`はKustomizeディレクトリをビルドし、ManifestをBundleとして返します。ローカルのoverlayまたはbaseを指定する例です。

```mcl verify snapshot=guide-kustomize-1 fixture=kustomize-local expect=0.metadata.name=example
import "std:kustomize" as kustomize

let resources = kustomize.build(
  source = ".",
  revision = "",
  directory = "k8s/base",
)
emit resources
```

ローカルsourceの`source`には呼び出し元MCLファイルからの相対パス、`revision`には空文字列、`directory`にはsource内の相対ディレクトリを指定します。読み込むファイルはプロジェクトルート内に置きます。

Git sourceを使う場合は、HTTPS Repository URLと40桁のcommit SHA-1を指定します。`mcl update`がsourceを取得してlockとキャッシュを更新します。通常の評価はロック済みキャッシュを参照し、ネットワークへ接続しません。ブランチ名、タグ名、短縮SHA、SSH sourceは指定できません。

詳しくは[標準関数の仕様](../reference/functions/)、[外部依存の更新](../reference/cli/#update)を参照してください。
