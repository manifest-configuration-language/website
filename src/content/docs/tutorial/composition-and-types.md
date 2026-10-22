---
title: "合成と型"
sidebar:
  order: 1
---

# 合成と型

MCLの`with:`はMapを再帰的に合成します。右側で指定したフィールドが優先され、右側にないMapフィールドは保たれます。Listは要素単位ではなくList全体を置き換えます。

```mcl expected-error error=selector
let defaults =
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata:
    labels:
      app: "catalog"
  spec:
    replicas: 2
    template:
      metadata:
        labels:
          app: "catalog"
      spec:
        containers:
          - name: "catalog"
            image: "example.test.walnuts.dev/catalog:v1"
            ports:
              - containerPort: 8080

let production = defaults with:
  metadata:
    name: "catalog"
  spec:
    replicas: 4

emit production
```

`production`では`spec.replicas`が4になり、既定値の`spec.template`は保たれます。合成は元のMapを書き換えません。

## 型注釈

構造型でMapのフィールドと値の型を宣言できます。構造型は閉じた型です。必須フィールドがない場合や、宣言されていないフィールドを含む場合はエラーになります。

```mcl verify snapshot=tutorial-composition-and-types-1 expect=0.name=catalog,0.ports.0=8080
type Container =
  name: String
  image: String
  ports?: List<Int>

let container: Container =
  name: "catalog"
  image: "example.test/catalog:v1"
  ports:
    - 8080

emit container
```

フィールド名の末尾の`?`は省略可能なフィールドを表します。型注釈は値の検証に使われ、値自体を書き換えません。ジェネリック型やUnion型を含む型の詳細は[型リファレンス](../reference/types/)を参照してください。

## フィールドの削除

`without:`とフィールドパスを使うと、Mapのフィールドを削除できます。指定先が存在しない場合はエラーです。

```mcl verify snapshot=tutorial-composition-and-types-2 expect=0.securityContext.capabilities={}
let base =
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop:
        - "ALL"

let stable = base without:
  - .securityContext.capabilities.drop

emit stable
```

削除後も`base`は変更されません。次は[関数と検証](./functions-and-validation)へ進みます。
