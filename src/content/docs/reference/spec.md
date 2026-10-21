---
title: "言語仕様"
---

# 言語仕様

このページはMCLの処理モデルを概説します。構文・型・診断の詳細と実装済み機能の完全な一覧は[言語リファレンス](./language)を参照してください。MCLはYAMLそのものではなく、Manifestなどの構造化データを生成するインデント形式の言語です。

## ソースファイル

ソースファイルには、先頭の`import`、値・関数・型・Ruleの定義、`emit`文、明示的な検証を記述します。モジュールは相対パスで読み込み、別モジュールから利用する定義には`export`を付けます。import先の出力と検証はエントリーファイルに記述します。

```mcl
import "./defaults.mcl" as defaults

let service = defaults.service with:
  metadata:
    name: "catalog"

emit service
```

## 値と式

値はString、整数、Decimal、Bool、`null`、Map、Listです。MapとListはインデントで記述します。空のMapとListには`{}`と`[]`を使います。Mapキーは識別子または二重引用符で囲んだStringです。コメントは`#`から行末までです。

式には名前とフィールドの参照、List添字、関数呼び出し、ラムダ、条件式、`if`式、List内包表記、演算子、`with:`による合成、`without:`によるフィールド削除があります。Stringは二重引用符または三重二重引用符で囲みます。

MCLにはYAMLの暗黙型変換、シングルクォート、空でないインラインMap/List、YAMLのanchor・alias・tag構文はありません。YAML入力を取り込む場合は`std:manifest` Adapterを使います。

## 宣言と評価

`let`定義は不変で、定義後の名前を参照できます。循環する値定義は評価前にエラーになります。関数は`fn`またはラムダで定義します。`type`は型名、`rule`は検証条件を定義します。`emit`で出力する値を指定し、複数の値は宣言順のYAML文書になります。Listを`emit`するとList全体が単一のYAML Sequence文書になります。`emit each`はListの要素を個別の出力として扱います。Kubernetes向けの`mcl check`と`mcl render`は通常のList Artifactを拒否し、各Resourceを`emit each`で出力するよう要求します。

`with:`はMapを再帰合成し、右側を優先します。Listは右側全体で置き換えられます。`without:`は指定したMapフィールドを削除します。いずれも元の値を変更しません。

## 型検査と検証

型注釈には基本型、構造型、List・Map・Function・Node型、Union、文字列リテラル型、ジェネリック型を使えます。構造型は閉じた型で、必須フィールドの欠落と未宣言フィールドをエラーにします。Union型の条件付き絞り込みや式の型推論は実装範囲内で行いますが、すべての式の組み合わせを静的に推論するわけではありません。

`validate`でRuleを実行します。Ruleは`require`式で条件を宣言し、すべての条件が`true`の場合に成功します。検証は値を書き換えません。JSON Schema、Kubernetes Resource Schema、CRD Schemaを使う検証はAdapterまたはSchema型を通じて行います。

## 出力と外部入力

CLIの`check`はソースを解析・評価し、出力可能性とResource識別情報を検証します。`render`はBundleをYAMLまたはJSONへ出力します。Adapterで参照する外部データは`mcl update`でロックし、通常の評価ではロック済みキャッシュを使います。

Parser、AST、Formatterを含む実際の文法、数値やファイルの上限、エラー条件は[言語リファレンス](./language)を正とします。このページは独立したEBNFではなく、現在の実装に沿った概要です。
