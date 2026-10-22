---
title: "式と合成"
sidebar:
  order: 3
---

## 合成

`with:`は右側を優先する明示的な合成です。両側がMapの場合はキーごとに再帰合成し、左側にないキーは追加します。Listは連結せず、右側のList全体で置き換えます。同じ型のScalarは右側で置き換えます。右側が`null`の場合は`null`に置き換え、異なる型の値を合成しようとするとエラーになります。

同じMapキーを複数回の`with:`で上書きした後にSchemaの追加プロパティ検証が失敗すると、LSP診断は最後に上書きしたキーを主位置にし、前のキー位置を関連情報に表示します。

既存フィールドを異なる型の値で置き換える場合は`replace(value)`を使います。`replace`は`with:`の既存フィールドにだけ指定でき、新しいフィールドには使えません。型注釈がある場合、置換後の値も注釈に適合する必要があります。

```mcl expected-error error=cannot
let original =
  config:
    enabled: true

let modified = original with:
  config: replace("disabled")
```

```mcl verify snapshot=reference-expressions-1 expect=0.name=api
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

```mcl release-gap error=RemovalExpr
let restricted = container without:
  - .securityContext.capabilities.add
```

`node:`は評価中の同一性を持つMapまたはListを作ります。`std:helm`、`std:kustomize`、`std:manifest`のBundleに含まれるMapまたはListも、それぞれNode同一性を持ちます。AdapterのResourceは`exactlyOne`などで選択し、`with:`で合成するか`ref(node)`で参照できます。YAML出力には同一性を含めません。`ref(node)`はNodeの内容を返し、`ref(node).field`は全`emit`値の確定後に対象Nodeのフィールドを読み取ります。対象Nodeが出力に存在しない場合はエラーにします。`ref(root, child).field`はroot Nodeの内部にあるchild Nodeのフィールドを読み取ります。同じNodeを複数回出力するとエラーになります。`with:`でNodeのMapを合成した場合は同一性を保ちます。`clone(value)`は値を複製し、含まれるすべてのNodeに新しい同一性を割り当てます。複製したNode内の`ref`は複製先のNodeを参照します。

```mcl verify snapshot=reference-expressions-2 fixture=manifest-load expect=0.metadata.name=catalog
import "std:manifest" as manifest

let resources = manifest.load("resources.yaml")
emit resources
```

`manifest.load`はScalarの`!!null`、`!!bool`、`!!int`、`!!float`、`!!str`、Sequenceの`!!seq`、Mappingの`!!map`だけを受け入れます。その他の明示tagはYAMLの行・列を示すエラーになります。

```mcl verify snapshot=reference-expressions-3 expect=0.spec.ports.0.name=http,1.targetPort=http
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
