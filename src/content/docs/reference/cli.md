---
title: "CLI"
sidebar:
  order: 6
---

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
