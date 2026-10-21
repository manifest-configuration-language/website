---
title: "型"
sidebar:
  order: 4
---

## 型

`type`で構造型や型エイリアスを定義し、`let`に型注釈を付けられます。対応する型は`Null`、`Bool`、`Int`、`Decimal`、`String`、文字列リテラル型、`Any`、`List<T>`、`Map<String, T>`、`Function<T1, ..., Tn, R>`、`Node<T>`、Union、Map構造型です。`type DeploymentKind = "Deployment"`のように、二重引用符で囲んだ文字列をStringの値を一つに限定する型として定義できます。型エイリアスは`type Box<T> = {value: T}`のように型パラメーターを宣言でき、注釈では`Box<String>`のように型引数を指定します。`List<Box<String>>`のような入れ子の型も指定できます。`Node<T>`は`node:`で作成した値を表し、フィールドや添字の参照では中身の`T`として扱います。`node:`値には`Node<T>`または中身の型`T`を注釈できます。通常の`T`値は自動的に`Node<T>`へ変換しません。`ref(node)`は参照先の中身の型`T`を返します。Optionalフィールドはキー名の末尾に`?`を付けて表します。構造型は閉じた型で、必須フィールドの欠落と未定義フィールドをエラーにします。

```mcl verify
type Port =
  name: String
  containerPort: Int
  protocol: String

type Box<T> = {value: T}
type NamedBox<T> = Box<T> | {name: String, value: T}

type DeploymentKind = "Deployment"
type Resource = {kind: DeploymentKind, spec: {replicas: Int}} | {kind: "Service", spec: {ports: List<Int>}}

type Container =
  name: String
  image: String
  ports?: List<Port>

let container: Container =
  name: "api"
  image: "example.test/api:v1"
  ports:
    - name: "http"
      containerPort: 8080
      protocol: "TCP"
emit container
```

`schema("./path/to/schema.json")`でローカルJSON Schemaを読み込み、`schema("https://example.test/schema.json")`でロック済みHTTPS Schemaを型として使えます。`mcl update`はHTTPS SchemaとHTTPSの`$ref`を取得して`mcl.lock`へSHA-256を記録し、通常の評価はキャッシュを照合してネットワークへ接続しません。ローカルSchemaとローカル`$ref`の参照先はプロジェクトルート内に限定します。Schemaの検証は値を変更せず、JSON Schemaの制約違反をエラーにします。単純な`type`、`properties`、`required`、`items`と兄弟制約のない`$ref`から推論できる型は、フィールド参照、List要素、既知の型不一致の静的検査にも使います。省略可能なプロパティを通る参照は、後続フィールドの有無と型が既知の場合に静的検査します。参照全体が有効でも省略可能なプロパティを通る場合は結果型を確定しません。その他のSchema制約は値の最終検証で判定します。検証エラーのインスタンス位置を取得でき、対象がローカルManifest YAMLの場合は、違反値の行または`additionalProperties`違反のキー行を診断します。Schemaファイルは1ファイル16 MiB、参照全体128ファイル・32 MiBまでです。

型定義は同じファイル内では直接名、import先ではexportされた型をalias.Typeの形式で参照します。型エイリアスの型引数は定義時にアリティと未知の型パラメーターを検査します。再帰構造型はListやMapフィールドを介して定義できます。循環する型エイリアスはエラーになります。Union型の全ての候補にあるフィールド参照は各候補の型を結合して推論し、候補から欠けるフィールドはOptional参照で`Null`を含めて推論します。条件式では`==`、`!=`とリテラル値を使ってUnion型の候補を絞り込みます。文字列リテラル型のフィールドを比較すると、その値に一致するUnion候補だけが残り、各枝のフィールド参照や関数呼び出しに絞り込んだ型を使います。リテラル、Map、List、`for`式、`with:`合成、`without:`削除、先行する`let`定義、通常およびOptionalのフィールド参照、条件式、対応する演算子、名前付き関数と標準関数から型を部分的に推論し、既知の型注釈との不一致や既知の不正な関数引数を値の評価前に検出します。全ての式の組み合わせの推論には対応していません。

```mcl verify fixture=schema-deployment
type Deployment = schema("./schemas/deployment.json")

let deployment: Deployment =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: "api"
  spec:
    replicas: 2
    selector:
      matchLabels:
        app: "api"
    template:
      metadata:
        labels:
          app: "api"
      spec:
        containers:
          - name: "api"
            image: "example.test/api:v1"
emit deployment
```
