---
title: "構文と値"
sidebar:
  order: 1
---

## 設計原則

- MapとListはインデントで記述し、空のMapとListだけ`{}`と`[]`で表します。
- 文字列は二重引用符で囲みます。暗黙の文字列変換はありません。
- `let`は値を定義し、`emit`は出力対象を明示します。
- 値の合成と検証を分けます。検証は値を書き換えません。
- コア言語はKubernetes固有のフィールドや意味を持ちません。
- 外部入力と出力は決定的に処理し、同じ入力から同じ出力を生成します。

## ファイル構造

ファイルは`import`、型と`let`の定義、`emit`文から構成されます。`import`は定義より前に書き、`emit`は定義より後に書きます。複数の値を出力すると、YAMLの複数ドキュメントになります。`emit each values`はListの各要素を独立した出力として追加します。Artifact直下のListはKubernetes向け出力で拒否されるため、Listを複数のManifestとして出力するときは`emit each`を使います。トップレベル文の順序が出力順序になります。

MCLソースはエントリーファイル、import先、文字列からの解析のいずれも1ファイル16 MiBまでです。

```mcl verify expect=0.metadata.name=sample,0.data.MODE=production
let name = "sample"
let resource =
  apiVersion: "v1"
  kind: "ConfigMap"
  metadata:
    name: name
  data:
    MODE: "production"

emit resource
```

`let`は定義後に変更できません。同じ名前を複数回定義できません。値の参照は先に定義した名前を使います。定義間の循環参照は評価前に検出してエラーにします。フィールド参照は`resource.metadata.name`の形式です。未定義の名前やフィールドを参照すると評価エラーになります。

`[]`でMapのキーまたはListの添字を参照できます。MapのキーはString、Listの添字は0から始まるIntです。キーが存在しない場合や添字が範囲外の場合は評価エラーになります。アクセスはフィールド参照と組み合わせられます。
Map、List、キーや添字の型を静的に推論できる場合は、対応するキー型・添字型を評価前に検査します。構造型Mapでは、文字列リテラル、先行する`let`定義、文字列連結からキーを確定できる場合に、存在しないキーを評価前にエラーにします。

```mcl fragment
let servicePort = service.spec.ports[0].port
let configValue = settings["mode"]
```

## 値

MCLは`String`、整数、十進数、`Bool`、`null`、`List`、`Map`を扱います。Listには`-`を必ず付けます。空でないMapやListをインラインで記述する構文、シングルクォート、YAMLのanchor、alias、tag、暗黙の型変換はありません。

```mcl release-gap
let settings =
  enabled: true
  retries: 3
  labels:
    app: "sample"
  ports:
    - 8080
    - 9090
  annotations: {}
  arguments: []
```

Mapのキーは識別子または二重引用符で囲んだ文字列です。重複キーは構文エラーです。コメントは`#`から行末までです。インデントにはスペースを使い、タブは使えません。

文字列は二重引用符または三重二重引用符で囲みます。三重二重引用符を同じ行で閉じると、区切りの間をそのまま文字列として扱います。複数行文字列では開始区切りの後に改行し、終了区切りを単独行に置きます。空でない本文行の共通インデントを除去し、空行の空白は除去します。本文の先頭と末尾にある区切り用の改行は値に含めず、CRLFはLFに変換します。本文中の`#`とタブはそのまま保持し、終了区切りを本文へ含めるエスケープ方法はありません。Formatterは本文の内容と相対インデントを保持し、改行をLFへ統一します。

計算したMapキーには`key(expression): value`を使います。式の結果はStringでなければならず、静的キーを含む重複も評価時にエラーになります。型検査と値の評価は別々に行われます。MCL v0.1.0は計算キーを含むMapを評価できないため、次の例をリリースギャップとして分類します。

```mcl release-gap
let annotationName = "example.org/checksum"
let annotations =
  key(annotationName): "abc123"
  "example.org/enabled": "true"

let output =
  checksum: annotations[annotationName]
  enabled: annotations["example.org/enabled"]

emit output
```

計算キーの型が静的にStringと判定できる場合、Mapの値型も推論します。推論できない計算キーや値があるMapは、型注釈との整合性を静的に判定しません。

## 現在の実装範囲

現在の言語コアは、`import`と明示的な`export`、`let`、`fn`、`type`、型注釈と対応する式に対する静的型推論、`emit`、インデントMap/List、Mapのフィールド・キー参照とListの添字参照、Optional参照、ラムダ・名前付き関数・標準関数呼び出し、演算子、条件式、List内包表記、`with:`による明示的な合成、`without:`によるMapフィールドの削除、Nodeと遅延`ref`、型付きRuleとRule合成、`require`ごとの任意の診断文、単一値・Bundle全体・`descendants(output, Type)`に対する明示的な検証、YAMLとJSON出力を実装しています。関数呼び出しの戻り値型は宣言と実引数から推論し、条件式、演算子、List内包表記、Map/List、合成、添字アクセスを含む式へ伝播します。条件式はタグフィールドとリテラルの比較などでUnion候補を絞り込みます。関数型のUnionは全候補の引数シグネチャに適合する呼び出しを受け付け、候補の戻り値型をUnionとして推論します。未注釈ラムダを変数に束縛した場合も、呼び出し時の実引数型から本体の戻り値型を推論します。この推論は`map`、`filter`、`exactlyOne`、`fold`に渡す関数値にも適用します。`map`で計算した値のSchema診断は変換式または名前付き関数の本体を示し、元List要素を関連位置に示します。

最終出力に存在しないNodeへの`ref`は`E401`で診断し、参照式の範囲と元Node定義位置を表示します。

`validate`でRuleに違反した場合は`E501`を報告し、検証対象の範囲とRule内のrequire式を関連位置に表示します。require式が比較式で一方の値がリテラルなら、もう一方の評価値をActualとして表示します。それ以外はrequire式の評価結果がfalseであることをActualとして表示します。検証対象からKubernetesリソース識別子を取得できる場合は診断に含めます。

型注釈のMapに宣言されていないキーがある場合は`E201`を報告し、未知のキーの範囲を示します。名前が既知のフィールドに近い場合は候補を表示し、型aliasまたはSchema由来の型名とSchema pathが分かる場合は診断へ含めます。CLIとLSPは同じ診断情報を表示します。
