---
title: "ParserとASTの構成"
---

# ParserとASTの構成

## Lexer

Lexerはabsolute byte cursorで元sourceから直接tokenを生成し、物理行全体を中間値へ切り出しません。識別子・literal・演算子・区切り記号は絶対byte offsetの`SourceSpan`を持ちます。改行とインデントは`NEWLINE`・`INDENT`・`DEDENT` tokenで表現し、行番号、indent、物理行span、literal metadataもtoken metadataに保持します。コメントと空行はtriviaとして保持します。文字列などのdecode済みliteral値は対応するliteral tokenに関連付けます。

Lexerは文法規則を解釈せず、括弧内の改行継続などtoken境界の判定に必要な状態を管理します。不正なindentやliteralはソース位置付きdiagnosticとして返します。

## Parser

`internal/syntax`のParserは共通token列と元sourceを使ってstatement、型式、式、Map、Listを構築します。syntax ASTのnodeと式のspanは元source全体に対する絶対offsetです。構文境界の判定と式の切り出しに`sourceLine`や行単位の再lexingは使いません。複数行literal、コメント、Unicodeを含む場合もtoken spanを基準に範囲を扱います。

`NEWLINE`・`INDENT`・`DEDENT`はblockとcollectionの境界を表す構文tokenです。Parserはtokenのindentとline metadataを使ってentry境界や診断行を決め、共通token cursorを進めます。括弧内の継続式はabsolute span内の既存tokenから解析し、literal内部の括弧を構文境界として数えません。

## ASTとtyped IR

`syntax.ParseAST`はsource span付きのsyntax ASTを構築します。各式種別は専用structで表し、List、Map、Call、演算子、lambda、条件分岐などの子式はclosed interfaceで保持します。コメントや空行などFormatterに必要なtriviaもsource span付きで保持します。`internal/engine.ParseAST`と`pkg/mcl.ParseAST`は同じ`syntax.ModuleAST`を返し、解析・lint・評価の間で構文木を複製しません。構文上の型式は`syntax.TypeExpr`に保持し、Engineは意味解析時にSchemaや型スコープを含む意味型へ解決します。静的型推論と検査はtyped IRへloweringし、typed IRは独自のkind、operator、解決済み型、式spanを持ちます。評価器はASTのkindやoperator文字列を実行時に解釈しません。

## RuntimeValueと出力境界

`internal/engine`のTyped IR evaluatorは`RuntimeValue`を生成し、deferred continuation、lambda、Node、Map、Listなどの実行時状態をRuntimeValueの構造で管理します。参照解決、型検証、Schema/CRD検証もEngineがRuntimeValueを扱います。Helm処理は`internal/helmrender`、Kustomize処理は`internal/kustomizeadapter`をAdapterとして呼び出し、RuntimeValueとの変換をEngineで行います。`RuntimeBundle`はRuntimeValueのArtifact群を保持し、遅延値の解決後にのみ公開評価APIの`Bundle`へ変換します。`Value`への変換はこの最終Bundle/YAML出力境界に限られます。

## Formatter

FormatterはParserが生成したAST・token列・triviaを使って構文範囲とコメントの対応を決めます。描画では物理行spanを単位としてsource本文と改行を保持し、ASTのsyntax spanとtokenのindent情報から各行の構造を接続します。物理行を描画単位として使うのは、コメント、空行、改行形式、元sourceの範囲を保つためです。構文境界の解析はabsolute token/spanを使い、Formatterの物理行描画モデルとは分離されています。
