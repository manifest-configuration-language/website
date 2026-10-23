---
title: "Kubernetes Manifest"
sidebar:
  order: 1
---

MCLはKubernetes ResourceをMapとして定義し、`emit`で出力します。複数Resourceを別々のYAML文書として出力するには`emit each`を使います。

```mcl verify snapshot=guide-kubernetes-1 expect=0.metadata.name=api
let appName = "api"

let deployment =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: appName
  spec:
    replicas: 2
    selector:
      matchLabels:
        app: appName
    template:
      metadata:
        labels:
          app: appName
      spec:
        containers:
          - name: appName
            image: "example.test/api:v1"

emit deployment
```

まず`mcl check main.mcl`で構文、評価結果、Resourceの識別情報を検証します。`mcl render main.mcl`は検証後のManifestをYAMLとして出力します。`check`はファイルを変更せず、Manifestも出力しません。

複数のResourceを生成する場合は、Listを作って`emit each resources`で出力します。通常の`emit resources`はList全体を一つのYAML Sequenceとして扱うため、Kubernetes向けの`check`と`render`では受け付けません。

MCLはKubernetes APIサーバーに接続せず、kubeconfigも読み込みません。組み込みKindとBundle内CRDから分かるscopeを使ってResourceを検査します。scopeが分からないResourceも出力できるため、全Kindをプロジェクト設定に登録する必要はありません。未知Resourceの重複検査には宣言されたnamespaceを使います。scopeが分かるNamespaced Resourceではnamespace省略を`default`として扱い、Cluster-scoped Resourceにnamespaceが指定されている場合はエラーにします。

詳しくは[組み込みScope情報](../reference/cli/#組み込みscope情報)、[構文と値](../reference/syntax/)、[検証](../reference/validation/)を参照してください。
