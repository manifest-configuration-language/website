---
title: "標準関数"
sidebar:
  order: 5
---

## 標準関数

IntとDecimalには`+`、`-`、`*`、`/`、`%`を使えます。同じ数値型同士で演算し、異なる数値型は暗黙変換しません。Intは最大4096桁です。Decimalは係数が最大4096桁、指数の絶対値が最大10000で、入力表現は最大16384文字です。算術演算結果の文字列表現は最大16384桁です。YAML数値も同じ数値上限に従い、取り込み前の整数・Decimal表現は最大16384文字です。上限を超える数値は解析、評価、YAML取り込み時にエラーになります。Intの`/`は0方向へ切り捨て、Decimalの`/`は小数点以下16桁に丸めます。`+`はString同士の連結にも使えます。`==`と`!=`は値を比較し、Node同士の場合はNodeの同一性を比較します。`<`、`<=`、`>`、`>=`はInt、DecimalまたはStringを比較します。`and`、`or`、`not`はBoolを受け取り、`and`、`or`、`??`は短絡評価します。`in`はListの要素またはMapのStringキーの存在を調べます。括弧で演算の順序を指定できます。

`?.`はMapの任意フィールドを参照します。対象フィールドがない場合は`null`を返します。`??`は左辺が`null`の場合に右辺を返します。

値の分岐には`if`と`else`を使います。条件はBoolでなければならず、選択した分岐だけを評価します。

```mcl fragment
let replicas =
  if production:
    3
  else:
    1
```

Listから値を生成するには`for name in values:`を使います。各要素に対して本体を評価し、結果をListにまとめます。ループ本体がListを返す場合もflattenしません。

```mcl verify snapshot=reference-functions-1 expect=0.name=api,1.name=worker
let names =
  - "api"
  - "worker"
let containers =
  for name in names:
    name: name
    image: "example/" + name + ":latest"

emit each containers
```

MCLは`fn(parameter, ...) => expression`形式のラムダを値として扱います。ラムダは定義時の値を捕捉し、関数の引数として渡せます。
ラムダ本文から戻り値型を推論できる場合、関数値を通じた呼び出しにもその型を使って静的検査します。関数の引数型が`Function<...>`の場合、未注釈ラムダの引数型と戻り値型を期待型から補い、本文も検査します。
型注釈の`Function<T1, ..., Tn, R>`はn個の引数を取る関数を表し、最後の型引数が戻り値です。引数の一部だけを適用する部分適用はサポートしません。`fold`には直接渡すラムダ、型推論可能なラムダ値、または対応する引数型を持つ名前付き関数を渡せます。`fold`は初期値とList要素の型から2引数の関数を検査します。

名前付き関数は`fn name(parameter: Type, ...) -> ReturnType = expression`で定義します。関数本体には1つの式を記述し、Mapを返す場合はインデント形式を使えます。ローカル関数は戻り値型を省略でき、実装が戻り値型を推論します。再帰関数は戻り値型を明示してください。関数呼び出しでは位置引数と名前付き引数を使えます。遅延評価を含む関数呼び出しの引数と戻り値は、評価確定後に宣言型と照合します。評価時の関数呼び出し深度は256までです。モジュールから公開する関数は`export fn`で宣言し、引数型と戻り値型を明示します。

```mcl verify snapshot=reference-functions-2 expect=0.app=api-web
fn resourceName(app: String, component: String) -> String =
  app + "-" + component

export fn labels(name: String) -> Map<String, String> =
  app: name
  "app.kubernetes.io/name": name

emit labels(resourceName("api", "web"))
```

```mcl expected-error error=List
let offset = 10
let addOffset = fn(value) => value + offset
let values =
  - 1
  - 2
emit map(values, addOffset)
```

関数呼び出しは`name(arg1, arg2)`の形式で、位置引数と名前付き引数を使えます。複数行呼び出しでは、最後の引数を含めて各引数の末尾にカンマが必要です。

```mcl release-gap error=CallExpr
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

標準moduleの公開名と引数名は[生成された標準関数一覧](../stdlib-functions/)を参照してください。このページでは型検査、関数の動作、Adapter固有の制約を説明します。

位置引数と名前付き引数を併用する場合、同じ引数を重ねて指定したり、未知の名前を指定したりするとエラーです。`map`、`filter`、`exactlyOne`、`fold`の関数引数にはラムダまたは名前付き関数を指定できます。

Bundleに`apiextensions.k8s.io/v1`の`CustomResourceDefinition`と対応するCustom Resourceが含まれる場合、`mcl check`と`mcl render`はCRDのserved versionごとに`spec.versions[].schema.openAPIV3Schema`を収集し、`group/version`と`kind`が一致するResourceを検証します。組み込みSchemaまたは対応するBundle内CRD SchemaがないResourceはSchema検証を省略します。CRD SchemaとKubernetes ResourceのScope descriptorは、phaseやoperationで出力対象を絞る前に評価済みBundle全体から構築します。そのため別phaseのCRD SchemaもResource検証に使われ、Bundle内に不正なCRDまたは同じGroup/Kindで異なるScopeのCRDがあると、選択したphaseやoperationにそのCRDが含まれなくても検証エラーになります。重複Resourceの検査は出力対象phase内のArtifactに対して行います。検証にはKubernetesの構造Schema、現在のResourceだけで評価できる`x-kubernetes-validations`のCEL式、Listの`set`・`map`制約を使います。旧Resourceを渡さないため、`oldSelf`を必要とする遷移ルールは検証しません。値のdefault適用、pruning、API ServerのAdmission処理も行わないため、検証の成功はクラスタへの作成・更新やAdmissionの成功を保証しません。同じBundleに対応するCRDがないResourceには、この検証を適用しません。検証エラーはResource内の値を主位置にし、CRD Schemaの位置を関連情報に表示します。

`std:kustomize`の`build(source, revision, directory)`は、Kustomizeディレクトリをビルドし、Manifestを含むBundleを返します。ローカルsourceでは`source`に呼び出し元MCLファイルからの相対パス、`revision`に空文字列、`directory`にsourceからの相対パスを指定します。Git sourceでは`source`に`git+https://`で始まるRepository URL、`revision`に小文字40桁のcommit SHA-1、`directory`にRepository内の相対パスを指定します。Kustomizationファイル内の推移的Git参照は`https://host/org/repo.git//directory?ref=<40桁のcommit SHA-1>`形式に限り利用できます。Repositoryのルートを参照する場合は`//directory`を省略します。`mcl update`は参照された全commitを取得し、SHA-256を`mcl.lock`とコンテンツキャッシュへ記録します。通常の評価はキャッシュ済みsourceを一時ディレクトリへ展開して参照を書き換えるため、ネットワークへ接続しません。Git sourceの元ファイルはarchiveのSHA-256ごとに`.mcl/cache/kustomize-sources/`へ保存し、診断に利用します。SSH、ブランチ名、タグ名、短縮SHA、リダイレクト、submodule、symlink、Git以外のremote参照は拒否します。推移的参照は最大64件、深さ16、キャッシュarchiveの合計64 MiBまでです。各Git sourceは最大10,000ファイル、展開後16 MiBまでです。プロジェクトルート外のローカルファイル読み込みも拒否します。Kustomizeが入力元を追跡しているResourceでは、Lifecycle OriginにそのResourceのファイルlocatorを記録し、入力ファイルと一致する値やキーには元YAMLの範囲を割り当てます。変換後の値には入力行を主位置として割り当てず、値の型が変わった場合も元スカラーの範囲を関連位置として保持します。Schema診断では`kustomize.build`の式を主位置にし、追跡できた元ResourceのYAML範囲を関連情報に表示します。入力元を特定できないResourceには元YAMLの位置を表示しません。

```mcl verify snapshot=reference-functions-3 fixture=kustomize-local expect=0.metadata.name=example
import "std:kustomize" as kustomize

let resources = kustomize.build(
  source = ".",
  revision = "",
  directory = "k8s/base",
)
emit resources
```

Git sourceの例です。

```mcl fragment
let resources = kustomize.build(
  source = "git+https://github.com/example/infra.git",
  revision = "0123456789abcdef0123456789abcdef01234567",
  directory = "k8s/base",
)
```

`std:manifest`の`load(source)`は、プロジェクト内のローカルYAMLファイルまたはロック済みHTTPS URLを読み込み、Manifestを含むBundleを返します。ArtifactのLifecycle OriginにはローカルManifestのプロジェクトルートからの相対パス、またはHTTPS URLを記録します。ローカルYAMLの構文エラーで行番号を取得できる場合は、該当行全体を診断範囲にします。ローカルYAMLから読み込んだ値は元ファイルの行範囲を保持し、後続の型検証エラーも元の範囲を診断します。Record型に存在しないYAMLフィールドは、そのキーの行を診断します。行番号を取得できない場合とHTTPS Manifestのエラーは`manifest.load`の呼び出し箇所を診断します。`mcl update <file>`はHTTPS Manifestを取得し、SHA-256を`mcl.lock`に記録して`.mcl/cache/sha256/`へ保存します。通常の評価はロックとキャッシュを照合し、ネットワークへ接続しません。HTTPSリダイレクトには対応しません。

`std:lifecycle`の`attach(value, events, priority, wait, cleanup)`は、Map形式のManifestにライフサイクル情報を付けます。Bundleには適用できません。`events`には`bootstrap`、`before.create`、`after.create`、`before.update`、`after.update`、`before.delete`、`after.delete`、`before.rollback`、`after.rollback`、`verify`を指定できます。`cleanup`には`before-next-run`、`on-success`、`on-failure`を指定できます。`wait`は後段のExecutorへHook完了待機を要求するmetadataです。`mcl render`はHookを実行せず、`lifecycle.json`へ`wait`と`cleanup`を出力します。`priority`が小さいArtifactから出力します。

```mcl verify snapshot=reference-functions-4 expect=empty,lifecycle.operation=create,lifecycle.artifacts.0.wait=true,lifecycle.artifacts.0.priority=-10,lifecycle.artifacts.0.events.0=before.create,lifecycle.artifacts.0.cleanup.0=before-next-run,lifecycle.artifacts.0.cleanup.1=on-success
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

```mcl verify snapshot=reference-functions-5 fixture=helm-local expect=0.data.image-tag=1.2.3
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

```mcl verify snapshot=reference-functions-6 expect=0.count=2,0.key=APP_MODE
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
