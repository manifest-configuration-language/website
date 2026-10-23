---
title: "モジュール"
sidebar:
  order: 2
---

## モジュール

相対パスのMCLファイルを`import`で読み込み、`export let`、`export type`、`export rule`で公開された定義を別モジュールから参照できます。インポートしたモジュール内の`emit`と`validate`はエラーになります。出力と検証はエントリーファイルに記述します。エントリーファイルから親ディレクトリを上へ探索し、最も近い`mcl.toml`があるディレクトリをプロジェクトルートにします。`mcl.toml`がない場合は、エントリーファイルのディレクトリをルートとして扱います。import先はプロジェクトルート内に限定し、シンボリックリンクを通じたルート外への参照も拒否します。`mcl.lock`と`.mcl/cache/`もプロジェクトルートに置きます。

```mcl verify snapshot=reference-modules-1 fixture=modules-container expect=0.name=api
import "./components/container.mcl" as defaults

let container = defaults.container with:
  name: "api"

emit container
```

```mcl fragment
# components/container.mcl
let privateValue = "internal"

export let container =
  securityContext:
    allowPrivilegeEscalation: false
```

モジュール内で`export`を付けない定義は非公開です。`std:`標準ライブラリは直接呼び出すか、名前空間付きでimportできます。

`export type`で公開された型は、import aliasを使って型注釈に指定できます。exportされた構造型が非公開の型エイリアスを参照する場合も、定義元の型環境で検証します。

```mcl verify snapshot=reference-modules-2 fixture=module-type-annotation expect=0.name=api,0.image=example.test/api:v1
import "./types.mcl" as types

let container: types.Container =
  name: "api"
  image: "example.test/api:v1"
emit container
```
