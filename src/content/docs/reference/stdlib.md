---
title: "標準ライブラリ"
sidebar:
  order: 9
---

# 標準ライブラリ

標準関数は名前を直接呼び出すか、`std:`モジュールをimportして使います。演算子と関数の仕様は[標準関数](./functions/)を参照してください。

```mcl verify snapshot=reference-stdlib-1 expect=0.distinctPorts.1=9090,0.key=mode
import "std:list" as lists
import "std:map" as maps

let ports =
  - 8080

let additionalPorts =
  - 8080
  - 9090

let distinctPorts = lists.union(ports, additionalPorts)
let settings =
  mode: "production"
let key = maps.keyOf(settings, "mode")

let output =
  distinctPorts: distinctPorts
  key: key

emit output
```

## `std:core`

| 関数             | 説明                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `len(value)`     | StringのUnicodeコードポイント数、Listの要素数、Mapのキー数を返します。それ以外の型はエラーです。 |
| `replace(value)` | `with:`で既存フィールドを異なる型の値に置き換えるために使います。                                |
| `clone(value)`   | 値を複製し、含まれるNodeへ新しい同一性を割り当てます。                                           |

`replace`は`with:`のフィールド値としてのみ使えます。新しいフィールドには使えません。

## `std:list`

| 関数                                   | 説明                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `contains(values, value)`              | Listの要素を比較します。第1引数がStringなら部分文字列を検索します。                                         |
| `concat(first, second)`                | 二つのListを順番に連結します。                                                                              |
| `union(first, second)`                 | Listを連結し、重複する値を最初の出現位置に一つだけ残します。                                                |
| `replaceAt(values, index, value)`      | 0始まりの添字にある要素を置き換えます。添字が範囲外ならエラーです。                                         |
| `mergeByKey(existing, overrides, key)` | 指定キーが同じMapを再帰合成し、一致しないoverrideを末尾に追加します。各List内のキー欠落や重複はエラーです。 |
| `map(values, transform)`               | 各要素に1引数関数を適用し、元の順序で結果を返します。                                                       |
| `filter(values, predicate)`            | 述語が`true`を返す要素を元の順序で返します。                                                                |
| `exactlyOne(values, predicate)`        | 述語が`true`を返す要素が一つだけの場合にその値を返します。それ以外はエラーです。                            |
| `fold(values, initial, combine)`       | Listを先頭から走査し、`combine(accumulator, value)`で値を集約します。                                       |

```mcl verify snapshot=reference-stdlib-2 expect=0.total=17170,0.securePorts.1=9090
import "std:list" as lists

let ports =
  - 8080
  - 9090

let securePorts = lists.filter(ports, fn(port) => port > 8000)
let total = lists.fold(ports, 0, fn(sum, port) => sum + port)

let output =
  securePorts: securePorts
  total: total

emit output
```

## `std:map`

| 関数                  | 説明                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `keyOf(mapping, key)` | Mapに存在するStringキーを返します。Map以外、String以外のキー、存在しないキーはエラーです。 |

## `std:lifecycle`

| 関数                                             | 説明                                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attach(value, events, priority, wait, cleanup)` | Manifest MapにLifecycle metadataを付けます。`value`はMap、`events`は空でないString List、`priority`はInt、`wait`はBool、`cleanup`はString Listである必要があります。 |

`events`が受け付ける値は`bootstrap`、`before.create`、`after.create`、`before.update`、`after.update`、`before.delete`、`after.delete`、`before.rollback`、`after.rollback`、`verify`です。`cleanup`は`before-next-run`、`on-success`、`on-failure`を受け付けます。`mcl render`はHookを実行せず、`lifecycle.json`へ待機要件とcleanup設定を記録します。

## Adapter

Adapter関数は外部ファイルやChartを読み込み、Manifest Bundleを返します。パス制限、ロック、入力形式、オプションなどの詳細は[関数リファレンス](./functions/)を参照してください。

| モジュールと関数                                   | 説明                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `std:manifest.load(source)`                        | ローカルYAML Manifestまたはロック済みHTTPS Manifestを読み込みます。   |
| `std:kustomize.build(source, revision, directory)` | ローカルKustomize overlayまたは固定commitのGit sourceをビルドします。 |
| `std:helm.render(source, options)`                 | ローカルまたはロック済みのHTTPS・OCI Chartをレンダリングします。      |

例は[Manifest Adapter](https://github.com/manifest-configuration-language/examples/tree/main/adapters/manifest)、[Kustomize Adapter](https://github.com/manifest-configuration-language/examples/tree/main/adapters/kustomize)、[Helm Adapter](https://github.com/manifest-configuration-language/examples/tree/main/adapters/helm)を参照してください。
