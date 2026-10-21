---
title: "検証"
sidebar:
  order: 7
---

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

## Rule制約の表現

複数Artifactを横断する制約には`validate output using ruleName`を使います。条件付き制約は`require`内の条件式、論理演算子、`if`式で記述できます。条件専用のRule宣言構文は設けません。

Parser、Formatter、型付きIRなど内部設計の方針は[ParserとASTの再設計](architecture/parser-ast.md)を参照してください。
