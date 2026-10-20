# 関数と検証

名前付き関数とラムダを使って、値の変換や条件判定を再利用できます。次の例はListから本番用の値だけを選びます。

```mcl
let environments =
  - name: "development"
    replicas: 1
  - name: "production"
    replicas: 3

let production = exactlyOne(environments, fn(environment) => environment.name == "production")

let deployment =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: "catalog"
  spec:
    replicas: production.replicas
    selector:
      matchLabels:
        app: "catalog"
    template:
      metadata:
        labels:
          app: "catalog"
      spec:
        containers:
          - name: "catalog"
            image: "example.test.walnuts.dev/catalog:v1"

emit deployment
```

`exactlyOne`は述語に一致する要素がちょうど1つのとき、その要素を返します。一致する要素が0個または複数の場合はエラーです。

## Rule

`rule`は値の制約を定義し、`validate`で明示的に実行します。

```mcl
type Deployment =
  apiVersion: String
  kind: "Deployment"
  metadata:
    name: String
  spec:
    replicas: Int

let deployment: Deployment =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    name: "catalog"
  spec:
    replicas: 2

rule scalable(resource: Deployment):
  require resource.spec.replicas >= 1 message "replicas must be at least 1"

emit deployment
validate deployment using scalable
```

`require`の条件が`false`なら検証エラーになります。Ruleの検証は値を変更しません。Bundle全体や型に一致する子孫の検証など、検証対象の指定方法は[言語リファレンス](../reference/language#ruleによる検証)を参照してください。

## さらに学ぶ

- [標準ライブラリ](../reference/stdlib)でList、Map、Adapterの関数を確認します。
- [言語仕様](../reference/spec)で構文と評価の概要を確認します。
- [examples/](https://github.com/manifest-configuration-language/examples/tree/main)でAdapterやSchemaを使う実例を確認します。
