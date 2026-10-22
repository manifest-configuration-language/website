---
title: "Helm Chart"
sidebar:
  order: 2
---

`helm.render`はChartを評価してBundleを返します。ローカルChartを使う場合は、Chartのファイルをプロジェクト内に置き、MCLファイルからの相対パスを指定します。

```mcl verify snapshot=guide-helm-1 fixture=helm-local expect=0.data.image-tag=1.2.3
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

`kubeVersion`と`apiVersions`は必須です。Chartが参照するKubernetesのバージョンと追加APIを明示します。Chartの`values.schema.json`は指定した`values`を検証します。`operation`と`revision`はHelm Release contextへ渡します。

HTTPS ChartアーカイブまたはOCI Chartを使う場合は、`source`とChartの`version`を指定してから`mcl update`を実行します。更新時に取得したChartは`mcl.lock`と`.mcl/cache/`へ記録され、通常の評価ではキャッシュを使います。認証が必要なRegistryや、Helm Repository名からのChart解決には対応していません。

詳しくは[標準関数の仕様](../reference/functions/)、[ロックファイルの更新](../reference/cli/#update)を参照してください。
