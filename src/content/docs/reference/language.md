---
title: "MCL言語仕様"
---

# MCL言語仕様

この文書は現在のCLIが解釈する言語の仕様です。実装済みの機能と今後必要な機能を区別します。Parser、AST、Formatterの内部設計は[ParserとASTの再設計](architecture/parser-ast.md)、遅延評価の設計は[遅延評価](architecture/deferred-evaluation.md)を参照してください。

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

```mcl
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

```mcl
let servicePort = service.spec.ports[0].port
let configValue = settings["mode"]
```

## モジュール

相対パスのMCLファイルを`import`で読み込み、`export let`、`export type`、`export rule`で公開された定義を別モジュールから参照できます。インポートしたモジュール内の`emit`と`validate`はエラーになります。出力と検証はエントリーファイルに記述します。エントリーファイルから親ディレクトリを上へ探索し、最も近い`mcl.toml`があるディレクトリをプロジェクトルートにします。`mcl.toml`がない場合は、エントリーファイルのディレクトリをルートとして扱います。`mcl.toml`ではKubernetes Resource Catalogのrevisionと追加Descriptorを設定できます。import先はプロジェクトルート内に限定し、シンボリックリンクを通じたルート外への参照も拒否します。`mcl.lock`と`.mcl/cache/`もプロジェクトルートに置きます。

```mcl
import "./components/container.mcl" as defaults

let container = defaults.container with:
  name: "api"

emit container
```

```mcl
# components/container.mcl
let privateValue = "internal"

export let container =
  securityContext:
    allowPrivilegeEscalation: false
```

モジュール内で`export`を付けない定義は非公開です。`std:`標準ライブラリは直接呼び出すか、名前空間付きでimportできます。

`export type`で公開された型は、import aliasを使って型注釈に指定できます。exportされた構造型が非公開の型エイリアスを参照する場合も、定義元の型環境で検証します。

```mcl
import "./types.mcl" as types

let container: types.Container =
  name: "api"
  image: "example.test/api:v1"
```

## 合成

`with:`は右側を優先する明示的な合成です。両側がMapの場合はキーごとに再帰合成し、左側にないキーは追加します。Listは連結せず、右側のList全体で置き換えます。同じ型のScalarは右側で置き換えます。右側が`null`の場合は`null`に置き換え、異なる型の値を合成しようとするとエラーになります。

同じMapキーを複数回の`with:`で上書きした後にSchemaの追加プロパティ検証が失敗すると、LSP診断は最後に上書きしたキーを主位置にし、前のキー位置を関連情報に表示します。

既存フィールドを異なる型の値で置き換える場合は`replace(value)`を使います。`replace`は`with:`の既存フィールドにだけ指定でき、新しいフィールドには使えません。型注釈がある場合、置換後の値も注釈に適合する必要があります。

```mcl
let original =
  config:
    enabled: true

let modified = original with:
  config: replace("disabled")
```

```mcl
let defaults =
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - "ALL"

let container = defaults with:
  name: "api"
  securityContext:
    capabilities:
      add:
        - "NET_BIND_SERVICE"

emit container
```

この例では、`securityContext.allowPrivilegeEscalation`と`capabilities.drop`を保持しながら、`name`と`capabilities.add`を追加します。合成によって元の`defaults`は変更されません。

Mapフィールドの削除には`without:`とフィールドパスを使います。対象のMapフィールドが存在しない場合はエラーになり、元の値は変更しません。

```mcl
let restricted = container without:
  - .securityContext.capabilities.add
```

`node:`は評価中の同一性を持つMapまたはListを作ります。`std:helm`、`std:kustomize`、`std:manifest`のBundleに含まれるMapまたはListも、それぞれNode同一性を持ちます。AdapterのResourceは`exactlyOne`などで選択し、`with:`で合成するか`ref(node)`で参照できます。YAML出力には同一性を含めません。`ref(node)`はNodeの内容を返し、`ref(node).field`は全`emit`値の確定後に対象Nodeのフィールドを読み取ります。対象Nodeが出力に存在しない場合はエラーにします。`ref(root, child).field`はroot Nodeの内部にあるchild Nodeのフィールドを読み取ります。同じNodeを複数回出力するとエラーになります。`with:`でNodeのMapを合成した場合は同一性を保ちます。`clone(value)`は値を複製し、含まれるすべてのNodeに新しい同一性を割り当てます。複製したNode内の`ref`は複製先のNodeを参照します。

```mcl
import "std:manifest" as manifest

let resources = manifest.load("resources.yaml")
let deployment = exactlyOne(resources, fn(resource) => resource.kind == "Deployment")
let changed = deployment with:
  spec:
    replicas: 3
emit changed
```

`manifest.load`はScalarの`!!null`、`!!bool`、`!!int`、`!!float`、`!!str`、Sequenceの`!!seq`、Mappingの`!!map`だけを受け入れます。その他の明示tagはYAMLの行・列を示すエラーになります。

```mcl
let port = node:
  name: "http"
  containerPort: 8080
let deployment = node:
  spec:
    ports:
      - port
let service = node:
  targetPort: ref(deployment, port).name
emit deployment
emit service
```

遅延参照は標準関数の引数やBool式の中でも解決します。

## 値

MCLは`String`、整数、十進数、`Bool`、`null`、`List`、`Map`を扱います。Listには`-`を必ず付けます。空でないMapやListをインラインで記述する構文、シングルクォート、YAMLのanchor、alias、tag、暗黙の型変換はありません。

```mcl
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

計算したMapキーには`key(expression): value`を使います。式の結果はStringでなければならず、静的キーを含む重複も評価時にエラーになります。

```mcl
let annotationName = "example.org/checksum"
let annotations =
  key(annotationName): "abc123"
  "example.org/enabled": "true"
```

計算キーの型が静的にStringと判定できる場合、Mapの値型も推論します。推論できない計算キーや値があるMapは、型注釈との整合性を静的に判定しません。

## 型

`type`で構造型や型エイリアスを定義し、`let`に型注釈を付けられます。対応する型は`Null`、`Bool`、`Int`、`Decimal`、`String`、文字列リテラル型、`Any`、`List<T>`、`Map<String, T>`、`Function<T1, ..., Tn, R>`、`Node<T>`、Union、Map構造型です。`type DeploymentKind = "Deployment"`のように、二重引用符で囲んだ文字列をStringの値を一つに限定する型として定義できます。型エイリアスは`type Box<T> = {value: T}`のように型パラメーターを宣言でき、注釈では`Box<String>`のように型引数を指定します。`List<Box<String>>`のような入れ子の型も指定できます。`Node<T>`は`node:`で作成した値を表し、フィールドや添字の参照では中身の`T`として扱います。`node:`値には`Node<T>`または中身の型`T`を注釈できます。通常の`T`値は自動的に`Node<T>`へ変換しません。`ref(node)`は参照先の中身の型`T`を返します。Optionalフィールドはキー名の末尾に`?`を付けて表します。構造型は閉じた型で、必須フィールドの欠落と未定義フィールドをエラーにします。

```mcl
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

```mcl
type Deployment = schema("./schemas/deployment.json")

let deployment: Deployment =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: "api"
emit deployment
```

## 標準関数

IntとDecimalには`+`、`-`、`*`、`/`、`%`を使えます。同じ数値型同士で演算し、異なる数値型は暗黙変換しません。Intは最大4096桁です。Decimalは係数が最大4096桁、指数の絶対値が最大10000で、入力表現は最大16384文字です。算術演算結果の文字列表現は最大16384桁です。YAML数値も同じ数値上限に従い、取り込み前の整数・Decimal表現は最大16384文字です。上限を超える数値は解析、評価、YAML取り込み時にエラーになります。Intの`/`は0方向へ切り捨て、Decimalの`/`は小数点以下16桁に丸めます。`+`はString同士の連結にも使えます。`==`と`!=`は値を比較し、Node同士の場合はNodeの同一性を比較します。`<`、`<=`、`>`、`>=`はInt、DecimalまたはStringを比較します。`and`、`or`、`not`はBoolを受け取り、`and`、`or`、`??`は短絡評価します。`in`はListの要素またはMapのStringキーの存在を調べます。括弧で演算の順序を指定できます。

`?.`はMapの任意フィールドを参照します。対象フィールドがない場合は`null`を返します。`??`は左辺が`null`の場合に右辺を返します。

値の分岐には`if`と`else`を使います。条件はBoolでなければならず、選択した分岐だけを評価します。

```mcl
let replicas =
  if production:
    3
  else:
    1
```

Listから値を生成するには`for name in values:`を使います。各要素に対して本体を評価し、結果をListにまとめます。ループ本体がListを返す場合もflattenしません。

```mcl
let names =
  - "api"
  - "worker"
let containers =
  for name in names:
    name: name
    image: "example/" + name + ":latest"
```

MCLは`fn(parameter, ...) => expression`形式のラムダを値として扱います。ラムダは定義時の値を捕捉し、関数の引数として渡せます。
ラムダ本文から戻り値型を推論できる場合、関数値を通じた呼び出しにもその型を使って静的検査します。関数の引数型が`Function<...>`の場合、未注釈ラムダの引数型と戻り値型を期待型から補い、本文も検査します。
型注釈の`Function<T1, ..., Tn, R>`はn個の引数を取る関数を表し、最後の型引数が戻り値です。引数の一部だけを適用する部分適用はサポートしません。`fold`には直接渡すラムダ、型推論可能なラムダ値、または対応する引数型を持つ名前付き関数を渡せます。`fold`は初期値とList要素の型から2引数の関数を検査します。

名前付き関数は`fn name(parameter: Type, ...) -> ReturnType = expression`で定義します。関数本体には1つの式を記述し、Mapを返す場合はインデント形式を使えます。ローカル関数は戻り値型を省略でき、実装が戻り値型を推論します。再帰関数は戻り値型を明示してください。関数呼び出しでは位置引数と名前付き引数を使えます。遅延評価を含む関数呼び出しの引数と戻り値は、評価確定後に宣言型と照合します。評価時の関数呼び出し深度は256までです。モジュールから公開する関数は`export fn`で宣言し、引数型と戻り値型を明示します。

```mcl
fn resourceName(app: String, component: String) -> String =
  app + "-" + component

export fn labels(name: String) -> Map<String, String> =
  app: name
  "app.kubernetes.io/name": name
```

```mcl
let offset = 10
let addOffset = fn(value) => value + offset
let values =
  - 1
  - 2
emit map(values, addOffset)
```

関数呼び出しは`name(arg1, arg2)`の形式で、位置引数と名前付き引数を使えます。複数行呼び出しでは、最後の引数を含めて各引数の末尾にカンマが必要です。

```mcl
let result = mergeByKey(
  existing = base,
  overrides = updates,
  key = "name",
)
```

- `len`はStringのUnicodeコードポイント数、Listの要素数、Mapのキー数を返します。
- `contains`はListに値が含まれるか、Stringに部分文字列が含まれるかを返します。
- `concat`は二つのListを連結します。
- `union`はListを連結し、重複値を最初の出現順を保って一つにまとめます。
- `keyOf`はMapに指定キーがあることを確認し、そのキー名を返します。Mapのキー集合と文字列定数を推論できる場合は、文字列連結や先行する`let`定義を含めて評価前にキーの存在を検査します。
- `replaceAt`はListの指定位置にある値を置き換えます。replacementの型がListの要素型と一致しない場合は、評価前にエラーにします。
- `mergeByKey`はMapのList同士を指定キーで照合し、一致項目を再帰合成して新しい項目を追加します。要素の型とキー名を推論できる場合は、各要素のキー欠落を評価前に検出します。Listとキー値を定数として推論できる場合は、各List内のキー値の重複も評価前に検出します。Listを既に評価済みの変数で指定した場合は、合成結果と型注釈の不一致も`mergeByKey`の呼び出し前に検出します。
- `map`はListの各要素へ1引数の関数を適用し、結果をListで返します。ラムダまたは名前付き関数を指定できます。
- `filter`はListの各要素へ1引数の関数を適用し、Boolの結果がtrueの要素を返します。ラムダまたは名前付き関数を指定できます。
- `exactlyOne`はListからBoolを返す述語に一致する値を選び、一致数が1件でなければエラーにします。ラムダまたは名前付き関数を指定できます。
- `fold`はListの要素を初期値と2引数の関数で順に集約します。ラムダまたは名前付き関数を指定できます。
  `len`、`replace`、`clone`は`std:core`、List操作は`std:list`、Map操作は`std:map`からimportできます。これらの標準関数は直接呼び出せるほか、`map`などの関数引数にも指定できます。外部Bundleの値を変更するときは、`exactlyOne`などで対象を明示的に選び、`with:`で合成します。Bundle全体へ条件付きの変更を適用する関数はありません。

標準moduleの公開名と呼び出し形は次のとおりです。Adapterの制約は各節で説明します。

| Module          | Export                                                    | 引数と戻り値                                                                                                                                                                  |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `std:core`      | `len(value) -> Int`                                       | String、List、Mapを受け取り、Unicodeコードポイント数、要素数、キー数を返します。それ以外の型はエラーです。                                                                    |
| `std:core`      | `replace(value) -> Replacement`                           | `with:`の既存フィールド置換に使う値を返します。                                                                                                                               |
| `std:core`      | `clone(value) -> Value`                                   | 値を複製し、含まれるNodeに新しい同一性を割り当てます。                                                                                                                        |
| `std:list`      | `contains(values, value) -> Bool`                         | Listの要素比較、またはStringの部分文字列検索を行います。                                                                                                                      |
| `std:list`      | `concat(first, second) -> List<T>`                        | 二つのListを順に連結します。                                                                                                                                                  |
| `std:list`      | `union(first, second) -> List<T>`                         | 二つのListを連結し、等しい値を最初の出現順で一つにまとめます。                                                                                                                |
| `std:list`      | `replaceAt(values, index, value) -> List<T>`              | 0始まりの添字を置換します。添字がIntでない場合や範囲外の場合はエラーです。                                                                                                    |
| `std:list`      | `mergeByKey(existing, overrides, key) -> List<Map>`       | 指定キーが等しいMapを再帰合成し、未一致のoverrideを末尾へ追加します。両List内のキー欠落・重複はエラーです。                                                                   |
| `std:list`      | `map(values, transform) -> List<R>`                       | 各要素へ1引数関数を適用し、結果を同じ順序で返します。                                                                                                                         |
| `std:list`      | `filter(values, predicate) -> List<T>`                    | Boolを返す述語がtrueになる要素を元の順序で返します。                                                                                                                          |
| `std:list`      | `exactlyOne(values, predicate) -> T`                      | Boolを返す述語に一致する要素を一つ返します。一致数が0または2以上ならエラーです。                                                                                              |
| `std:list`      | `fold(values, initial, combine) -> R`                     | Listを先頭から順に走査し、`combine(accumulator, value)`で集約します。                                                                                                         |
| `std:map`       | `keyOf(mapping, key) -> String`                           | Mapに存在するStringキーを返します。Map以外、String以外のキー、存在しないキーはエラーです。                                                                                    |
| `std:lifecycle` | `attach(value, events, priority, wait, cleanup) -> Value` | `value`はMap、`events`は空でないStringのList、`priority`はInt、`wait`はBool、`cleanup`はStringのListです。Bundle、既存metadata、不正または重複したevent/cleanupはエラーです。 |
| `std:kustomize` | `build(source, revision, directory) -> Bundle`            | 三つの引数はStringです。Kustomizeディレクトリをビルドします。                                                                                                                 |
| `std:manifest`  | `load(source) -> Bundle`                                  | `source`はStringです。YAML Manifestを読み込みます。                                                                                                                           |
| `std:helm`      | `render(source, options) -> Bundle`                       | `source`はString、`options`はMapです。Helm Chartをレンダリングします。                                                                                                        |

位置引数と名前付き引数を併用する場合、同じ引数を重ねて指定したり、未知の名前を指定したりするとエラーです。`map`、`filter`、`exactlyOne`、`fold`の関数引数にはラムダまたは名前付き関数を指定できます。

Bundleに`apiextensions.k8s.io/v1`の`CustomResourceDefinition`と対応するCustom Resourceが含まれる場合、`mcl check`と`mcl render`はCRDのserved versionごとに`spec.versions[].schema.openAPIV3Schema`を収集し、`group/version`と`kind`が一致するResourceを検証します。CRD SchemaとKubernetes ResourceのScope descriptorは、phaseやoperationで出力対象を絞る前に評価済みBundle全体から構築します。そのため別phaseのCRD SchemaもResource検証に使われ、Bundle内に不正なCRDまたは同じGroup/Kindで異なるScopeのCRDがあると、選択したphaseやoperationにそのCRDが含まれなくても検証エラーになります。重複Resourceの検査は出力対象phase内のArtifactに対して行います。検証にはKubernetesの構造Schema、現在のResourceだけで評価できる`x-kubernetes-validations`のCEL式、Listの`set`・`map`制約を使います。旧Resourceを渡さないため、`oldSelf`を必要とする遷移ルールは検証しません。値のdefault適用、pruning、API ServerのAdmission処理も行わないため、検証の成功はクラスタへの作成・更新やAdmissionの成功を保証しません。同じBundleに対応するCRDがないResourceには、この検証を適用しません。検証エラーはResource内の値を主位置にし、CRD Schemaの位置を関連情報に表示します。

`std:kustomize`の`build(source, revision, directory)`は、Kustomizeディレクトリをビルドし、Manifestを含むBundleを返します。ローカルsourceでは`source`に呼び出し元MCLファイルからの相対パス、`revision`に空文字列、`directory`にsourceからの相対パスを指定します。Git sourceでは`source`に`git+https://`で始まるRepository URL、`revision`に小文字40桁のcommit SHA-1、`directory`にRepository内の相対パスを指定します。Kustomizationファイル内の推移的Git参照は`https://host/org/repo.git//directory?ref=<40桁のcommit SHA-1>`形式に限り利用できます。Repositoryのルートを参照する場合は`//directory`を省略します。`mcl update`は参照された全commitを取得し、SHA-256を`mcl.lock`とコンテンツキャッシュへ記録します。通常の評価はキャッシュ済みsourceを一時ディレクトリへ展開して参照を書き換えるため、ネットワークへ接続しません。Git sourceの元ファイルはarchiveのSHA-256ごとに`.mcl/cache/kustomize-sources/`へ保存し、診断に利用します。SSH、ブランチ名、タグ名、短縮SHA、リダイレクト、submodule、symlink、Git以外のremote参照は拒否します。推移的参照は最大64件、深さ16、キャッシュarchiveの合計64 MiBまでです。各Git sourceは最大10,000ファイル、展開後16 MiBまでです。プロジェクトルート外のローカルファイル読み込みも拒否します。Kustomizeが入力元を追跡しているResourceでは、Lifecycle OriginにそのResourceのファイルlocatorを記録し、入力ファイルと一致する値やキーには元YAMLの範囲を割り当てます。変換後の値には入力行を主位置として割り当てず、値の型が変わった場合も元スカラーの範囲を関連位置として保持します。Schema診断では`kustomize.build`の式を主位置にし、追跡できた元ResourceのYAML範囲を関連情報に表示します。入力元を特定できないResourceには元YAMLの位置を表示しません。

```mcl
import "std:kustomize" as kustomize

let resources = kustomize.build(
  source = ".",
  revision = "",
  directory = "k8s/base",
)
emit resources
```

Git sourceの例です。

```mcl
let resources = kustomize.build(
  source = "git+https://github.com/example/infra.git",
  revision = "0123456789abcdef0123456789abcdef01234567",
  directory = "k8s/base",
)
```

`std:manifest`の`load(source)`は、プロジェクト内のローカルYAMLファイルまたはロック済みHTTPS URLを読み込み、Manifestを含むBundleを返します。ArtifactのLifecycle OriginにはローカルManifestのプロジェクトルートからの相対パス、またはHTTPS URLを記録します。ローカルYAMLの構文エラーで行番号を取得できる場合は、該当行全体を診断範囲にします。ローカルYAMLから読み込んだ値は元ファイルの行範囲を保持し、後続の型検証エラーも元の範囲を診断します。Record型に存在しないYAMLフィールドは、そのキーの行を診断します。行番号を取得できない場合とHTTPS Manifestのエラーは`manifest.load`の呼び出し箇所を診断します。`mcl update <file>`はHTTPS Manifestを取得し、SHA-256を`mcl.lock`に記録して`.mcl/cache/sha256/`へ保存します。通常の評価はロックとキャッシュを照合し、ネットワークへ接続しません。HTTPSリダイレクトには対応しません。

`std:lifecycle`の`attach(value, events, priority, wait, cleanup)`は、Map形式のManifestにライフサイクル情報を付けます。Bundleには適用できません。`events`には`bootstrap`、`before.create`、`after.create`、`before.update`、`after.update`、`before.delete`、`after.delete`、`before.rollback`、`after.rollback`、`verify`を指定できます。`cleanup`には`before-next-run`、`on-success`、`on-failure`を指定できます。`wait`は後段のExecutorへHook完了待機を要求するmetadataです。`mcl render`はHookを実行せず、`lifecycle.json`へ`wait`と`cleanup`を出力します。`priority`が小さいArtifactから出力します。

```mcl
import "std:lifecycle" as lifecycle

let migration =
  apiVersion: "batch/v1"
  kind: "Job"
  metadata:
    name: "migration"
let events =
  - "before.create"
  - "before.update"
let cleanup =
  - "before-next-run"
  - "on-success"
let wait = true
let migrationHook = lifecycle.attach(
  value = migration,
  events = events,
  priority = -10,
  wait = wait,
  cleanup = cleanup,
)
emit migrationHook
```

`std:helm`の`render(source, options)`は、Helm Chartをレンダリングし、Artifactを含むBundleを返します。`source`には呼び出し元MCLファイルからの相対パス、HTTPS ChartアーカイブのURL、または`oci://host/repository/chart`形式のOCI参照を指定できます。HTTPSアーカイブとOCI参照では`version`にChartのバージョンを指定します。Chartアーカイブは圧縮後64 MiBまで、展開後100 MiBまでです。Chart.yamlに宣言された依存Chartは、Chartに同梱されたsubchartとChart名、SemVer version constraintを照合します。検証はnested dependenciesにも適用し、宣言されたsubchartが同梱されていない場合やversionが一致しない場合はエラーにします。Chart.yamlに宣言されていないcharts/内のsubchartもHelmの挙動に従ってレンダリングし、そのChart内の依存宣言を検証します。`Chart.lock`を使った依存Chartの外部取得は行いません。`mcl update`は参照されたHTTPSアーカイブとOCI Chartを取得して`.mcl/cache/sha256/`へ保存し、`mcl.lock`にダイジェストを記録します。OCI Chartはmanifest digest、Chart layer digest、保存したアーカイブのSHA-256を記録します。通常の評価はロック済みキャッシュを使い、ネットワークへ接続しません。OCI Registryへの通信はTLSを必須とし、匿名アクセスを使います。HelmとDockerの資格情報ファイルやOSの資格情報ストアは読み込みません。そのため、認証が必要なRegistryは利用できません。`options`には`values`、`releaseName`、`namespace`、`operation`、`revision`、`kubeVersion`、`apiVersions`、`version`を指定できます。`kubeVersion`と`apiVersions`はChartの内容にかかわらず必須で、ターゲットクラスターの値を明示します。追加APIがなければ`apiVersions: []`を指定します。`values`の既定値は空Map、`releaseName`の既定値は`mcl`、`namespace`の既定値は`default`、`operation`の既定値は`create`、`revision`の既定値は`1`です。`revision`にはHelm Release contextへ渡す1以上の整数を指定します。`operation`は`create`、`update`、`delete`、`rollback`、`verify`を受け付けます。DecimalをHelmへ渡す場合は`float64`で正確に表現できる必要があります。`0.1`のように正確に変換できないDecimalは丸めずにエラーにします。`mcl render --operation`を指定すると、CLIの操作種別が`options.operation`より優先され、Chartを同じ操作のHelm Release contextで評価します。Chartの`values.schema.json`による検証エラーは`options.values`のMap全体を診断範囲にします。Helm Hookは一般的なLifecycle eventへ変換し、Hook weightとdelete policyをArtifact metadataとして保持します。ローカルChartとロック済みHTTPS・OCI ChartでHelmがテンプレートパスと行番号を返す解析・実行エラーは、Chart元ファイルを診断します。ロック済みChartの元ファイルはアーカイブのSHA-256ごとに`.mcl/cache/helm-sources/`へ復元します。Hook metadata検証エラーはテンプレート元ファイル全体を範囲として診断します。この範囲は生成YAML内の該当行を示しません。`crds/`のYAMLファイルは`bootstrap` Artifactとして扱います。ローカルとロック済みChartの`crds/` YAMLは元ファイルの値とキーの範囲を診断に使います。テンプレートファイルに`{{`がなく、レンダー結果が元ファイルと完全一致する場合も値とキーの範囲を診断に使います。テンプレート式を含まないYAMLの出力解析エラーは、元ファイルと出力が一致する場合にChart元ファイルの該当行を診断します。出力を生成するHelmテンプレート式はマーカーで出力先を追跡し、YAMLの値またはMapキーへ一意に対応する場合は式の範囲をSchema診断に使います。関数呼び出し、テンプレート呼び出し、パイプ、MapやListを生成する式も追跡します。`indent`と`nindent`のパイプは計測時も適用して出力構造を保ちます。繰り返し出力される式と実行された分岐の式は、各出力先を式の範囲へ対応付けます。非実行分岐を含むテンプレートや同じ式が複数回出力される場合は、Helmテンプレートファイル全体も関連情報として示します。Helmリポジトリー名からのChart解決、Kubernetes API、DNS、時刻・乱数・証明書生成、bcryptを使う`htpasswd`に依存するテンプレート関数は利用できません。

```mcl
import "std:helm" as helm

let renderOptions =
  values:
    image:
      tag: "1.2.3"
  namespace: "production"
  operation: "update"
  revision: 4
  kubeVersion: "v1.34.0"
  apiVersions:
    - "apps/v1"
let resources = helm.render("charts/api", renderOptions)
emit resources
```

ManifestとKustomizeのYAML入力は16 MiB、300,000ノード、128階層までに制限します。KustomizeとHelmのビルド元ディレクトリに含まれるファイルの合計サイズも16 MiBまでです。

1回のMCL評価では、文と式の評価、遅延値の解決、Node索引の走査を合計1,000,000ステップまで実行できます。関数、ラムダ、Ruleの呼び出し深度は256段、List内包表記、`map`・`filter`・`exactlyOne`・`fold`、descendants検証の候補走査は合計100,000回までです。最終BundleのArtifactが保持するValueは、List、Map、Node、各要素やMap値を含めて合計300,000個までです。これとは別に、RuntimeValue割当予算単位を累計1,000,000までに制限します。型付き式の評価ごとに1単位、`clone`による複製・合成・削除・コレクション結果・Adapter Bundleの複製では結果グラフのRuntimeValue数を課金します。AdapterがManifest・Helm・KustomizeのYAMLからRuntimeValueを生成するときも各値を課金します。import aliasのMapとentryは各1単位です。Adapterが処理するYAML入力byte数の累計は64 MiBまでです。これらの予算はimport先と最終参照解決にも共有します。

割当単位はRuntimeValueの個数を基準にした上限であり、プロセス全体のheap byte数を保証しません。YAML parserの構造ノード、Helm・Kustomize内部の構造体、文字列やsliceの容量、その他の一時割当は別の入力サイズ制限で抑制しますが、この予算では個別に計測しません。

```mcl
import "std:list" as lists
import "std:map" as maps

let config =
  data:
    APP_MODE: "production"
let variables =
  - "api"
  - "worker"
let result =
  key: maps.keyOf(config.data, "APP_MODE")
  containsWorker: lists.contains(variables, "worker")
  count: len(variables)
emit result
```

## CLI

`mcl help`と`mcl --help`はコマンド一覧と主要なflagを表示します。`mcl help <command>`と`mcl <command> --help`は指定したコマンドの使い方とflagを表示します。

### Kubernetes Resource Catalog

`mcl.toml`の`[kubernetes.resourceCatalog]`で、組み込みCatalog revisionと追加Descriptorを指定できます。

```toml
[kubernetes.resourceCatalog]
revision = "mcl-kubernetes-resource-catalog-v1"

[[kubernetes.resourceCatalog.additionalResources]]
apiGroup = "example.test.walnuts.dev"
kind = "Widget"
resourceName = "widgets"
scope = "Namespaced"
```

Catalog tableがない場合は組み込みCatalogだけを使います。tableを設定する場合は現在の組み込みCatalog revisionを指定します。`apiGroup`に空文字列を指定するとcore API groupになります。未知のCatalog key、未対応revision、不正なDescriptorは`mcl check`と`mcl render`でエラーになります。Catalogはオフラインで固定され、クラスタからAPI情報を取得しません。Catalog設定は`mcl.lock`に記録しません。

### `render`

Kubernetes向け出力ではArtifact直下のListを拒否します。各Resourceを個別に出力する場合は`emit each values`を使います。

`mcl render <file>`はファイルを解析・評価し、`main` phaseのArtifactをYAMLで標準出力に書き込みます。`--format json`を指定するとArtifactをJSON配列として出力します。JSON内の整数とDecimalは元の数値表現を保ちます。`apiVersion`、`kind`、`metadata.name`から識別できるResourceは、組み込みCatalog、`mcl.toml`の追加Descriptor、またはBundle内CRDからscopeを解決できなければエラーになります。scopeを解決できるResourceが同じphaseに複数あり、API group、resource名、namespace、nameが一致する場合もエラーになります。重複キーにAPI versionは含めません。Bundle内にあるCRDは`spec.group`、`spec.names.kind`、`spec.names.plural`、`spec.scope`からResource descriptorを作ります。CRDの`spec.group`、`spec.names.kind`、`spec.names.plural`は空にできません。`spec.scope`は`Namespaced`または`Cluster`を指定し、その他の値はレンダリングエラーになります。Namespaced Resourceはnamespace省略時に`default`を使い、Cluster-scoped Resourceは`metadata.namespace`を指定するとエラーになります。`apiVersion`、`kind`、`metadata.name`などの識別情報を持たない一般的なYAML値は、Resource重複検査の対象外です。`mcl render --phase <event> <file>`は指定したLifecycle eventのArtifactを出力します。phase内ではpriorityの昇順で出力します。`mcl render --operation <name> --output-dir <directory> <file>`は操作に必要なYAMLファイルと`lifecycle.json`を出力先ディレクトリに書き込み、指定した操作種別をHelm Chartの評価にも適用します。`--format json`を併用すると、各phaseファイルをJSON配列として出力し、拡張子を`.json`にします。`lifecycle.json`の`documents`はJSON配列内の1始まりのArtifact位置を参照します。操作名は`create`、`update`、`delete`、`rollback`、`verify`です。`mcl render --operation`を使う場合、`helm.render`の`operation`指定はCLIの操作種別で上書きされます。出力先ディレクトリが空なら初回生成します。既存の出力先は`.mcl-manifest.json`と生成ファイルの内容を照合し、MCLが管理していないファイルや変更された生成ファイルがある場合は置換しません。`lifecycle.json`の`artifacts`各要素には`documents`配列があり、Artifactが出力されるphaseファイル名と、そのファイル内の1始まりの位置を記録します。複数のLifecycle eventで出力されるArtifactには参照が複数記録されます。参照順は固定ファイル順、各ファイル内のphase順、phase内のpriority順です。`index`はBundle内の0始まりのArtifact位置を示します。ファイルの生成前に入力を評価し、評価またはレンダリングに失敗した場合は出力先を変更しません。

組み込みCatalogは次のKindを扱います。記載のないKindやAPI groupは、`mcl.toml`の追加DescriptorまたはBundle内CRDでscopeを定義してください。scope未解決のResourceは`mcl check`と`mcl render`でエラーになります。

| Scope      | API group                      | Kind                                                                                                                                                    |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespaced | core                           | ConfigMap、Endpoints、Event、LimitRange、PersistentVolumeClaim、Pod、PodTemplate、ReplicationController、ResourceQuota、Secret、Service、ServiceAccount |
| Cluster    | core                           | Namespace、Node、PersistentVolume                                                                                                                       |
| Namespaced | `apps`                         | ControllerRevision、DaemonSet、Deployment、ReplicaSet、StatefulSet                                                                                      |
| Namespaced | `autoscaling`                  | HorizontalPodAutoscaler                                                                                                                                 |
| Namespaced | `batch`                        | CronJob、Job                                                                                                                                            |
| Cluster    | `admissionregistration.k8s.io` | MutatingWebhookConfiguration、ValidatingAdmissionPolicy、ValidatingAdmissionPolicyBinding、ValidatingWebhookConfiguration                               |
| Cluster    | `apiregistration.k8s.io`       | APIService                                                                                                                                              |
| Cluster    | `apiextensions.k8s.io`         | CustomResourceDefinition                                                                                                                                |
| Cluster    | `certificates.k8s.io`          | CertificateSigningRequest                                                                                                                               |
| Namespaced | `coordination.k8s.io`          | Lease                                                                                                                                                   |
| Namespaced | `discovery.k8s.io`             | EndpointSlice                                                                                                                                           |
| Cluster    | `flowcontrol.apiserver.k8s.io` | FlowSchema、PriorityLevelConfiguration                                                                                                                  |
| Namespaced | `networking.k8s.io`            | Ingress、NetworkPolicy                                                                                                                                  |
| Cluster    | `networking.k8s.io`            | IngressClass                                                                                                                                            |
| Cluster    | `node.k8s.io`                  | RuntimeClass                                                                                                                                            |
| Namespaced | `policy`                       | PodDisruptionBudget                                                                                                                                     |
| Namespaced | `rbac.authorization.k8s.io`    | Role、RoleBinding                                                                                                                                       |
| Cluster    | `rbac.authorization.k8s.io`    | ClusterRole、ClusterRoleBinding                                                                                                                         |
| Cluster    | `scheduling.k8s.io`            | PriorityClass                                                                                                                                           |
| Cluster    | `storage.k8s.io`               | CSIDriver、CSINode、StorageClass、VolumeAttachment                                                                                                      |

scopeを識別できるCluster-scoped Resourceは`metadata.namespace`を指定できません。

### `check`

`mcl check <file>`は構文解析と値の評価を行い、ArtifactをYAMLへ出力できる値か検証します。Resourceの重複とscopeも検証し、scope不明のResourceがある場合は`mcl.toml`の追加DescriptorまたはBundle内CRDによる定義が必要です。ファイルを変更せず、Manifestも出力しません。`mcl check --operation <name> <file>`は指定した操作向けに評価し、`render --operation`と同じHelm Release contextを検証します。操作名は`create`、`update`、`delete`、`rollback`、`verify`です。

### `explain`

`--phase`は対象Lifecycle phaseを選び、`--operation`は指定した操作用にBundleを評価します。省略時のphaseは`main`で、`--namespace default`はnamespace省略のNamespaced Resourceにも一致します。

`mcl explain --api-version <version> --kind <kind> --name <name> [--namespace <namespace>] [--path <json-pointer>] <file>`は、指定した識別子に一致するArtifactを1つ選び、JSON Pointerで指定した値をYAMLとソース位置で表示します。`--namespace`を省略するとnamespaceを絞り込みません。`--path`を省略または空文字にするとResource全体を選びます。JSON Pointerでは`~0`と`~1`を解釈し、Listの添字には0始まりの整数を指定します。一致するArtifactがない場合や複数ある場合はエラーになります。

表示するソース位置には、選択したMapフィールドのキー位置と値の位置、および評価時に保持された由来位置を含めます。Source Map APIは各出力値とkeyについてMCLの合成元、Kustomize入力または変換元、Helm式またはfallback範囲を分類し、Helm式が複数回出力された場合の回数と曖昧な対応を示します。由来情報は式の全依存関係を表しません。Helmのテンプレート構造と出力YAMLの対応を一意に再構成できない場合は、曖昧な由来としてテンプレート範囲を関連付けます。

### `diff`

`--operation <name>`を指定すると、before/afterの両方を同じ操作Contextで評価します。各入力ファイルのResource Catalogを使ってBundleを検証します。

`mcl diff <before-file> <after-file>`は二つのMCLファイルを評価し、Bundle内のResource追加・削除、フィールド追加・削除・変更、Lifecycle変更を表示します。ResourceはAPI group、`kind`、namespace、nameで対応付けます。CatalogでNamespacedと識別したResourceでは省略したnamespaceを`default`として扱い、Cluster-scoped Resourceではnamespaceをidentityから除外します。識別情報を持たないArtifactはBundle内の位置で対応付けます。Listの要素は添字で比較し、MapのフィールドはJSON Pointer形式のパスで表示します。

### `lint`

複数のファイルを同時に指定できます。`--deny-warnings`は警告が一件以上ある場合に非0で終了します。

`mcl lint <file>`は構文解析と静的参照解析を行い、`emit`、`validate`、exportされた宣言から到達できない`let`、`fn`、`type`、`rule`、import aliasを警告します。参照関係を推移的に辿り、間接的に使われる定義も使用済みとして扱います。警告には定義名のソース範囲と`MCLW001`コードを表示します。警告だけの場合は終了コード0を返します。Adapterを実行せず、Manifest出力の検証も行いません。

### `fmt`

`--check`は整形結果と元ファイルが異なる場合に非0で終了します。

`mcl fmt <file>`は構文を検証し、コメントを保ったまま2スペースのインデントに整形して標準出力に書き込みます。複数行の関数呼び出しで各引数に末尾カンマがない場合は構文エラーを返します。`mcl fmt -w <file>`は入力ファイルを置き換えます。

### `update`

`mcl update`は`main.mcl`を評価し、参照されたHTTPS Manifest、Schema、HTTPSまたはOCI Helm Chart、固定commitのGit sourceを取得して`mcl.lock`とコンテンツキャッシュを更新します。ロックにはMCL、Go、Helm、Kustomize API、kyamlのバージョンとビルドのVCS revision・modified状態を記録し、異なるツールチェーンでの通常評価を拒否します。コンテンツdigestはlock更新後の整合性と再現性を確認しますが、初回取得内容の発行者や真正性は確認しません。依存の初回追加とlock更新差分は利用者がレビューしてください。正式リリースのversionはビルド時にldflagsで注入でき、`mcl version`はversion、revision、modified状態を表示します。VCS情報を取得できないビルドではversion表示に`unknown`を使い、ロックのrevisionとmodified状態は空値として扱います。modified状態は未コミット変更の有無だけを記録し、同じrevision上の異なる未コミット差分は区別しません。既存のv1・v2ロックやツールチェーン情報が異なるロックは`mcl update`で更新します。別のエントリーファイルを使う場合は`mcl update <file>`を指定します。Manifest、Schema、Helm Chart、Git sourceの外部接続ではIPを検査し、loopback、private、link-local、multicast、unspecified、予約済み範囲のIPを返すホストを拒否します。HTTPS接続は環境proxyを使わず、検査した公開IPへ直接接続します。ロック更新中に評価または依存リソースの検証が失敗した場合、`mcl.lock`は更新しません。

### `lsp`

`mcl lsp`は標準入出力を使ってLanguage Server Protocolを提供します。初期化、完全同期、範囲付き増分同期、ファイルのオープン・変更・クローズ、文書全体のformatting要求に対応し、構文エラー、評価エラー、未使用定義の警告を診断として送信します。未定義参照と一部の型不一致は式の範囲を診断し、import先で起きた評価エラーはimport先のURIへ送信します。`with:`合成で値が型またはSchemaに適合しない場合は、上書き値を主位置にし、上書き前の値とネストしたMapの合成元、patch Mapを関連情報として表示します。開いているローカルMCLモジュールは保存前の内容でimport評価し、文書の変更・クローズ時に他の開いている文書の診断も再計算します。未使用定義の警告は定義名の範囲と`MCLW001`コードを持ちます。補完では同じファイル内の`let`、`type`、`rule`、`fn`定義とimport aliasを候補として表示します。関数パラメーター、ラムダパラメーター、`for`式のループ変数は有効範囲内で補完候補になり、定義ジャンプも宣言位置を示します。同じファイルで定義したSchema型またはimportしたexport Schema型が注釈されたMapでは、カーソル位置のネスト階層に対応するJSON Schemaの`properties`を補完候補にし、入力済みのフィールドを候補から除きます。ローカルChartとロック済みHTTPS・OCI Chartの`values.schema.json`は`helm.render`の`options.values`内で補完に使います。HTTPS・OCI Chartでは`mcl.lock`と`.mcl/cache/sha256/`の既存データだけを使い、補完要求中にChartやSchemaを取得しません。Chart archive内の相対JSON Schema参照は同じarchiveのファイルから解決し、archive外の参照は取得しません。Manifest Map内に文字列リテラルの`apiVersion`と`kind`がある場合は、Kustomize/kyaml組み込みResourceのOpenAPI Schemaからネストしたフィールドを補完します。同じMCLソースにリテラルで記述したCRDがある場合は、そのserved versionの`openAPIV3Schema`から同じBundle内のCustom Resourceを補完します。変数参照や計算式から組み立てたCRD Schemaは補完に使いません。組み込みSchemaも同じソース内のCRD Schemaも使えない場合は、明示的なJSON Schemaによる補完を使います。定義ジャンプでは同じファイル内の`let`、`type`、`rule`、`fn`に加え、importしたexport済みの`let`、`type`、`rule`、`fn`を参照位置から宣言位置へ移動できます。関数パラメーター、ラムダパラメーター、`for`式のループ変数にも移動できます。名前変更では、ローカル束縛と同一ファイル内の`let`、`fn`、`rule`、`type`を参照箇所とともに変更できます。exportされた`let`、`fn`、`rule`、`type`はプロジェクト内の定義とimport経由の参照をまとめて変更します。Schema field Renameは型注釈が省略された別名や関数戻り値から推論できる参照も扱い、import indexで収集した複数文書を一括変更します。

## Ruleによる検証

Ruleは型付きの1つの引数を受け取り、`require`式がすべて`true`の場合に成功します。引数型と、型推論できる`require`式はRuleの定義時に検査します。`export rule`で別モジュールに公開できます。Ruleを定義しただけでは実行されず、`emit`の後に`validate`を記述して明示的に実行します。検証はNode参照の解決後に行い、値を変更しません。

`require`から別のRuleを呼び出すと、子Ruleの違反も親Ruleの検証結果に含まれます。

`require`の末尾に`message "..."`を指定すると、その条件に固有の診断文を設定できます。メッセージは文字列リテラルに限定し、失敗時のActualと対象リソース識別子は診断に引き続き含めます。省略した場合は従来どおり式とActualから診断文を生成します。

単一値の検証には`validate value using ruleName`を使います。`validate output using ruleName`は最終Bundleの全Artifactをemit順に含む`List<Any>`を1回だけRuleへ渡します。Artifact内のNode参照を解決した後に検証し、lifecycle metadataは含めません。空Bundleでは空Listを渡します。`validate each descendants(output, Type) using ruleName`は最終BundleからQueryTypeに適合する値を選択し、既定で1件以上の一致を要求します。QueryTypeと互換な型注釈を持つ値は、`with:`や`without:`後の現在値がRule引数型に適合しない場合もRuleへ渡し、型不一致を検証エラーとして報告します。互換な型注釈がない値は、現在値がQueryTypeに適合する場合に候補になります。Kubernetes組み込みOpenAPI Schemaを持つResourceと、同じBundle内のCRD Schemaに対応するCustom Resourceは、Schemaが示す各フィールドとList要素の型情報を保持します。現在値ではなくAdapterが付与したSchema情報で対象を選ぶ場合は、`validate each descendants(output, select = bySchema(types.Container)) using ruleName`を使います。`bySchema(Type)`はSchema上の型が指定型と互換または静的に不明な、Schema情報を持つ子孫を選びます。選択後にRule引数型を値へ適用するため、値の型が不正な場合は検証エラーになります。`apiVersion`と`kind`が文字列のMapはKubernetes Resource候補として扱います。組み込みSchemaまたは同一Bundle内CRD Schemaがない候補を`bySchema`が走査すると、Resourceの位置を示す診断で検証に失敗します。Resourceの位置を取得できない場合は検証式の位置を診断します。`apiVersion`または`kind`を持たないMapはResource候補ではなく、Schema provenanceを持たないAdapter値も`bySchema`では検査されません。空の一致集合を許可する場合は`minMatches = 0`を明示します。`minMatches`には0から100,000までの整数リテラルを指定でき、条件を満たさない場合は検証エラーになります。`output`は検証ターゲットとdescendants queryの引数としてのみ使用できます。

```mcl
type Container = {securityContext?: Any}
let container =
  securityContext:
    allowPrivilegeEscalation: false
rule hardened(container: Container):
  require container.securityContext?.allowPrivilegeEscalation == false message "allowPrivilegeEscalation must be false"
emit container
validate container using hardened
```

## 現在の実装範囲

現在の言語コアは、`import`と明示的な`export`、`let`、`fn`、`type`、型注釈と対応する式に対する静的型推論、`emit`、インデントMap/List、Mapのフィールド・キー参照とListの添字参照、Optional参照、ラムダ・名前付き関数・標準関数呼び出し、演算子、条件式、List内包表記、`with:`による明示的な合成、`without:`によるMapフィールドの削除、Nodeと遅延`ref`、型付きRuleとRule合成、`require`ごとの任意の診断文、単一値・Bundle全体・`descendants(output, Type)`に対する明示的な検証、YAMLとJSON出力を実装しています。関数呼び出しの戻り値型は宣言と実引数から推論し、条件式、演算子、List内包表記、Map/List、合成、添字アクセスを含む式へ伝播します。条件式はタグフィールドとリテラルの比較などでUnion候補を絞り込みます。関数型のUnionは全候補の引数シグネチャに適合する呼び出しを受け付け、候補の戻り値型をUnionとして推論します。未注釈ラムダを変数に束縛した場合も、呼び出し時の実引数型から本体の戻り値型を推論します。この推論は`map`、`filter`、`exactlyOne`、`fold`に渡す関数値にも適用します。`map`で計算した値のSchema診断は変換式または名前付き関数の本体を示し、元List要素を関連位置に示します。

最終出力に存在しないNodeへの`ref`は`E401`で診断し、参照式の範囲と元Node定義位置を表示します。

`validate`でRuleに違反した場合は`E501`を報告し、検証対象の範囲とRule内のrequire式を関連位置に表示します。require式が比較式で一方の値がリテラルなら、もう一方の評価値をActualとして表示します。それ以外はrequire式の評価結果がfalseであることをActualとして表示します。検証対象からKubernetesリソース識別子を取得できる場合は診断に含めます。

型注釈のMapに宣言されていないキーがある場合は`E201`を報告し、未知のキーの範囲を示します。名前が既知のフィールドに近い場合は候補を表示し、型aliasまたはSchema由来の型名とSchema pathが分かる場合は診断へ含めます。CLIとLSPは同じ診断情報を表示します。

## Rule制約の表現

複数Artifactを横断する制約には`validate output using ruleName`を使います。条件付き制約は`require`内の条件式、論理演算子、`if`式で記述できます。条件専用のRule宣言構文は設けません。

Parser、Formatter、型付きIRなど内部設計の方針は[ParserとASTの再設計](architecture/parser-ast.md)を参照してください。
