---
title: "MCL"
---

# MCL

MCLは、YAML Manifestを型付きの値として組み立て、検証するための設定言語です。

```mcl verify expect=0.metadata.name=api
let service =
  apiVersion: "v1"
  kind: "Service"
  metadata:
    name: "api"
  spec:
    selector:
      app: "api"
    ports:
      - port: 8080
        targetPort: 8080

emit service
```

## 学ぶ

- [導入](/getting-started/)でCLIの準備と最初のManifest作成を行います。
- [チュートリアル](/tutorial/)で値の合成、型、検証を順に学びます。
- [言語リファレンス](/reference/)で構文と現在の実装範囲を確認します。
- [標準ライブラリ](/reference/stdlib)で関数とAdapterを確認します。
- [言語仕様](/reference/spec)で処理モデルと対応構文を確認します。

MCLの[GitHubリポジトリ](https://github.com/manifest-configuration-language/mcl)にはCLIがあります。VS Code拡張は[別のリポジトリ](https://github.com/manifest-configuration-language/vscode)、すべての[例](https://github.com/manifest-configuration-language/examples)は専用リポジトリで管理しています。
