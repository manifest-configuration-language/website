---
title: "最初のManifest"
sidebar:
  order: 2
---

次の内容を`main.mcl`として保存します。

```mcl verify snapshot=getting-started-quickstart-1 expect=0.metadata.name=catalog
let appName = "catalog"

let service =
  apiVersion: "v1"
  kind: "Service"
  metadata:
    name: appName
  spec:
    selector:
      app: appName
    ports:
      - name: "http"
        port: 8080
        targetPort: 8080

emit service
```

`let`は値に名前を付けます。Mapはインデントで書き、Listの各要素には`-`を付けます。文字列は二重引用符で囲みます。`emit`で出力する値を指定します。`let`定義だけではManifestは出力されません。

保存したファイルは次のコマンドで構文と値を検証し、YAMLを表示できます。

```sh
mcl check main.mcl
mcl render main.mcl
```

`check`と`render`はResourceの識別情報も検証します。例の`Service`は組み込みCatalogで認識されるKindです。

## Listと複数の出力

ManifestをListにまとめると、出力順を保ったまま複数の値を定義できます。複数の`emit`も同じように複数のYAML文書を出力します。

```mcl verify snapshot=getting-started-quickstart-2 expect=0.metadata.name=api,1.metadata.name=worker
let names =
  - "api"
  - "worker"

let deployments =
  for name in names:
    apiVersion: "apps/v1"
    kind: "Deployment"
    metadata:
      name: name
    spec:
      replicas: 2
      selector:
        matchLabels:
          app: name
      template:
        metadata:
          labels:
            app: name
        spec:
          containers:
            - name: name
              image: "example.test.walnuts.dev/" + name + ":v1"

emit each deployments
```

`map`は`std:list`の関数で、Listの各要素へ関数を適用します。MCLでは空でないListをインライン構文で書かず、インデントされたListとして記述します。

`emit`したListはYAML Sequenceとして1文書に出力されます。Kubernetes ResourceをListの各要素から出力するには`emit each`を使います。`mcl check`と`mcl render`は通常のListをArtifactとして出力することを拒否します。

次は[合成と型](../tutorial/composition-and-types/)へ進み、共通値の再利用と変更方法を学びます。
