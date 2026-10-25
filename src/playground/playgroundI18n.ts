import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const resources = {
  en: {
    starlight: {
      run: "Run",
      share: "Share",
      openExamples: "Examples",
      copyShareLink: "Copy share link",
      shareAccessNotice: "Anyone with the link can view this snapshot.",
      shareLinkCopiedUntil: "Share link copied (available until {{date}})",
      shareLinkCopied: "Share link copied",
      sharing: "Sharing",
      cancel: "Cancel",
      wasmWaiting: "WASM waiting",
      wasmLoading: "WASM loading",
      wasmInitializing: "WASM initializing",
      wasmReady: "WASM ready",
      wasmError: "WASM error",
      retry: "Retry",
      sourceCandidates: "Matching MCL locations",
      saveSaving: "Saving",
      saveSaved: "Saved locally",
      saveError: "Save failed",
      workspaceLabel: "MCL Playground",
      docsHome: "MCL documentation",
      editActions: "Editor actions",
      stop: "Stop",
      format: "Format",
      commandSearch: "Search commands",
      projectMenu: "Project",
      openProject: "Open project",
      unnamedProject: "Untitled project",
      projectCapabilities: "Language features",
      loadingProject: "Loading project",
      viewMode: "Workspace view",
      closeFile: "Close {{path}}",
      newFile: "Create file",
      openFiles: "Open files",
      results: "Results",
      resizePanels: "Resize editor and results",
      arrangeSideBySide: "Arrange side by side",
      arrangeStacked: "Stack panels",
      arrangeHorizontal: "Side by side",
      arrangeVertical: "Stacked",
      noProblems: "No problems",
      projectStatus: "Project status",
      filesCount: "{{count}} files",
      filesCount_one: "{{count}} file",
      filesCount_other: "{{count}} files",
      problemsCount: "{{count}} problems",
      problemsCount_one: "{{count}} problem",
      problemsCount_other: "{{count}} problems",
      fileSize: "{{size}} MiB",
      examplesGroupBasics: "Basics",
      examplesGroupConfiguration: "Structure",
      examplesGroupAdapters: "Adapters",
      examplesGroupValidation: "Validation",
      commandRun: "Run",
      commandFormat: "Format source",
      commandToggleComment: "Toggle comment",
      commandNextOccurrence: "Select next occurrence",
      commandSelectMatches: "Select all matches",
      commandOpenExamples: "Open examples",
      commandToggleExplorer: "Toggle file explorer",
      commandGoToDefinition: "Go to definition",
      commandGoToYaml: "Go to matching YAML",
      commandFindReferences: "Find references",
      commandRenameSymbol: "Rename symbol",
      commandShare: "Share",
      commandOpenFile: "Open file",
      commandCreateFile: "Create file",
      commandNewProject: "New project",
      commandShowOutput: "Show output",
      commandShowProblems: "Show problems",
      duplicateProject: "Duplicate project",
      deleteProject: "Delete project",
      formatSource: "Format source",
      fileTreeLabel: "Project files",
      files: "Files",
      createFile: "Create file",
      renameFile: "Rename file",
      deleteFile: "Delete file",
      settings: "Settings",
      colorScheme: "Color scheme",
      system: "System",
      light: "Light",
      dark: "Dark",
      indentationWidth: "Indentation",
      fontSize: "Font size",
      lineWrapping: "Line wrapping",
      lineNumbers: "Line numbers",
      vim: "Vim mode",
      examplesTitle: "Examples",
      close: "Close",
      searchExamples: "Search examples",
      searchNameOrCategory: "Search names or categories",
      noExamplesFound: "No matching examples",
      openFile: "Open file",
      goToFile: "Go to file",
      enterFilename: "Enter a file name",
      noFilesFound: "No matching files",
      commandPalette: "Command palette",
      searchCommand: "Search commands",
      noCommandsFound: "No matching commands",
      editor: "Editor",
      output: "Output",
      diff: "Diff",
      openExplorer: "Open file explorer",
      closeExplorer: "Close file explorer",
      renameFileFor: "Rename {{path}}",
      deleteFileFor: "Delete {{path}}",
      projectName: "Project name",
      renameProjectHint: "Rename project",
      editorSurface: "Editor",
      edit: "Edit",
      editorPosition: "Line {{line}}, column {{column}}",
      deleteFileTitle: "Delete file",
      renameFileTitle: "Rename file",
      createFileTitle: "Create file",
      deleteFilePrompt: "Delete {{path}}?",
      filePathLabel: "File path",
      renameSymbolTitle: "Rename symbol",
      renameChangesTitle: "Changes",
      beforeChange: "Before",
      afterChange: "After",
      reenterName: "Edit name",
      applyRename: "Rename",
      newName: "New name",
      reviewRename: "Review changes",
      previousOutput: "Previous output",
      yamlOutput: "YAML output",
      staleOutput: "Stale",
      latestOutput: "Latest",
      clearResourceSelection: "All resources",
      resource: "Resources",
      search: "Search",
      selectedResourceYaml: "{{label}} YAML output",
      previousYamlOutput: "Previous YAML output",
      renderedYamlOutput: "Rendered YAML",
      resourceSearch: "Search resources",
      searchResources: "Search resources",
      noResourcesMatch: "No matching resources",
      unchanged: "Unchanged",
      changed: "Changed",
      added: "Added",
      deleted: "Deleted",
      yamlDocument: "YAML documents",
      projectFolder: "Project files",
      openFolder: "Open folder",
      openZip: "Open ZIP",
      exportZip: "Export ZIP",
      importFolder: "Import project folder",
      importZip: "Import project ZIP",
      zipDropZone: "ZIP file drop zone",
      dropZipHere: "Drop a ZIP file here",
      projectSizeSummary: "{{size}} / {{limit}}",
      zipRequiredError: "Drop one ZIP file.",
      goToDefinitionMissing: "No definition at this position",
      renameSymbolNoTarget: "No renameable symbol at this position.",
      renameSymbolUnsupportedFiles: "Rename is unavailable for unsupported files.",
      editorNotReady: "The editor is not ready.",
      renamePreviewInvalid: "The rename preview is invalid.",
      renameSourceChanged: "The source changed before the rename was applied.",
      symbolRenamed: "Symbol renamed",
      copy: "Copy",
      download: "Download",
      referencesCount: "References {{count}}",
      draftConflictTitle: "Draft changed in another tab",
      draftConflictDescription:
        "Choose whether to keep this tab's changes or load the latest draft.",
      draftConflictFork: "Keep these changes in a new draft",
      draftConflictReload: "Load the latest draft",
      saveConflict: "Changes need review",
      referencesLabel: "References",
      searchReferences: "Search references",
      searchFilenameOrCode: "Search filenames or code",
      noReferencesMatch: "No matching references",
      emptyOutput: "Run the project to see its output",
      documentLabel: "Document {{number}}",
      yamlDiff: "YAML diff",
      allResources: "All",
    },
  },
  ja: {
    starlight: {
      run: "実行",
      share: "共有",
      openExamples: "サンプル",
      copyShareLink: "共有リンクをコピー",
      shareAccessNotice: "リンクを知っている人はこのスナップショットを閲覧できます。",
      shareLinkCopiedUntil: "共有リンクをコピーしました（{{date}}まで有効）",
      shareLinkCopied: "共有リンクをコピーしました",
      sharing: "共有中",
      cancel: "キャンセル",
      wasmWaiting: "WASM準備中",
      wasmLoading: "WASM読み込み中",
      wasmInitializing: "WASM初期化中",
      wasmReady: "WASM準備完了",
      wasmError: "WASMエラー",
      retry: "再試行",
      sourceCandidates: "対応するMCLの箇所",
      saveSaving: "保存中",
      saveSaved: "ローカルに保存済み",
      saveError: "保存に失敗",
      workspaceLabel: "MCL Playground",
      docsHome: "MCLドキュメント",
      editActions: "編集操作",
      stop: "中断",
      format: "整形",
      commandSearch: "コマンドを検索",
      projectMenu: "プロジェクト",
      openProject: "プロジェクトを開く",
      unnamedProject: "無題のプロジェクト",
      projectCapabilities: "対応機能",
      loadingProject: "読み込み中",
      viewMode: "表示",
      closeFile: "{{path}}を閉じる",
      newFile: "ファイルを作成",
      openFiles: "開いているファイル",
      results: "結果表示",
      resizePanels: "エディターと結果の配置を変更",
      arrangeSideBySide: "左右に並べる",
      arrangeStacked: "上下に並べる",
      arrangeHorizontal: "左右",
      arrangeVertical: "上下",
      noProblems: "問題はありません",
      projectStatus: "プロジェクトの状態",
      filesCount: "{{count}}ファイル",
      filesCount_other: "{{count}}ファイル",
      problemsCount: "{{count}}件の問題",
      problemsCount_other: "{{count}}件の問題",
      fileSize: "{{size}} MiB",
      examplesGroupBasics: "基本",
      examplesGroupConfiguration: "構成",
      examplesGroupAdapters: "Adapter",
      examplesGroupValidation: "検証",
      commandRun: "実行",
      commandFormat: "コードを整形",
      commandToggleComment: "コメントを切り替え",
      commandNextOccurrence: "次の一致を選択",
      commandSelectMatches: "すべての一致を選択",
      commandOpenExamples: "サンプルを開く",
      commandToggleExplorer: "ファイル一覧を切り替え",
      commandGoToDefinition: "定義へ移動",
      commandGoToYaml: "YAMLの対応箇所へ移動",
      commandFindReferences: "参照箇所を検索",
      commandRenameSymbol: "シンボル名を変更",
      commandShare: "共有",
      commandOpenFile: "ファイルを開く",
      commandCreateFile: "ファイルを作成",
      commandNewProject: "新しいプロジェクト",
      commandShowOutput: "出力を表示",
      commandShowProblems: "問題を表示",
      duplicateProject: "プロジェクトを複製",
      deleteProject: "プロジェクトを削除",
      formatSource: "コードを整形",
      fileTreeLabel: "プロジェクトファイル",
      files: "ファイル",
      createFile: "ファイルを作成",
      renameFile: "名前を変更",
      deleteFile: "削除",
      settings: "設定",
      colorScheme: "配色",
      system: "システム",
      light: "ライト",
      dark: "ダーク",
      indentationWidth: "インデント幅",
      fontSize: "文字サイズ",
      lineWrapping: "折り返し",
      lineNumbers: "行番号",
      vim: "Vim",
      examplesTitle: "サンプル",
      close: "閉じる",
      searchExamples: "サンプルを検索",
      searchNameOrCategory: "名前やカテゴリで検索",
      noExamplesFound: "一致するサンプルはありません",
      openFile: "ファイルを開く",
      goToFile: "ファイルへ移動",
      enterFilename: "ファイル名を入力",
      noFilesFound: "一致するファイルはありません",
      commandPalette: "コマンド",
      searchCommand: "コマンドを検索",
      noCommandsFound: "一致するコマンドはありません",
      editor: "エディター",
      output: "出力",
      diff: "差分",
      openExplorer: "ファイル一覧を開く",
      closeExplorer: "ファイル一覧を閉じる",
      renameFileFor: "{{path}}の名前を変更",
      deleteFileFor: "{{path}}を削除",
      projectName: "プロジェクト名",
      renameProjectHint: "プロジェクト名を変更",
      editorSurface: "エディター",
      edit: "編集",
      editorPosition: "{{line}}行、{{column}}列",
      deleteFileTitle: "ファイルを削除",
      renameFileTitle: "ファイル名を変更",
      createFileTitle: "新規ファイル",
      deleteFilePrompt: "{{path}}を削除しますか？",
      filePathLabel: "ファイルパス",
      renameSymbolTitle: "シンボル名を変更",
      renameChangesTitle: "変更箇所",
      beforeChange: "変更前",
      afterChange: "変更後",
      reenterName: "名前を再入力",
      applyRename: "名前を変更",
      newName: "新しい名前",
      reviewRename: "変更箇所を確認",
      previousOutput: "前回の出力",
      yamlOutput: "YAML出力",
      staleOutput: "古い結果",
      latestOutput: "最新",
      clearResourceSelection: "すべてのリソース",
      resource: "リソース",
      search: "検索",
      selectedResourceYaml: "{{label}}のYAML出力",
      previousYamlOutput: "前回のYAML出力",
      renderedYamlOutput: "レンダリング結果",
      resourceSearch: "リソース検索",
      searchResources: "リソースを検索",
      noResourcesMatch: "一致するリソースはありません",
      unchanged: "変更なし",
      changed: "変更",
      added: "追加",
      deleted: "削除",
      yamlDocument: "YAML文書",
      projectFolder: "プロジェクトファイル",
      openFolder: "フォルダーを開く",
      openZip: "ZIPを開く",
      exportZip: "ZIPを書き出す",
      importFolder: "プロジェクトフォルダーを読み込む",
      importZip: "プロジェクトZIPを読み込む",
      zipDropZone: "ZIPファイルのドロップ領域",
      dropZipHere: "ZIPをここにドロップ",
      projectSizeSummary: "{{size}} / {{limit}}",
      zipRequiredError: "ZIPファイルを1つドロップしてください。",
      goToDefinitionMissing: "この位置に定義はありません",
      renameSymbolNoTarget: "この位置に変更可能なシンボルがありません。",
      renameSymbolUnsupportedFiles:
        "対応していないファイルが含まれているため名前を変更できません。",
      editorNotReady: "エディターの準備ができていません。",
      renamePreviewInvalid: "名前変更プレビューが無効です。",
      renameSourceChanged: "名前を変更する前にソースが変更されました。",
      symbolRenamed: "シンボル名を変更しました",
      copy: "コピー",
      download: "ダウンロード",
      referencesCount: "参照{{count}}件",
      draftConflictTitle: "別のタブでドラフトが変更されました",
      draftConflictDescription:
        "このタブの変更を新しいドラフトに残すか、最新の内容を読み込んでください。",
      draftConflictFork: "変更を新しいドラフトに残す",
      draftConflictReload: "最新のドラフトを読み込む",
      saveConflict: "変更の確認が必要です",
      referencesLabel: "参照箇所",
      searchReferences: "参照を検索",
      searchFilenameOrCode: "ファイル名またはコードを検索",
      noReferencesMatch: "参照が見つかりません",
      emptyOutput: "実行すると結果が表示されます",
      documentLabel: "文書{{number}}",
      yamlDiff: "YAML差分",
      allResources: "全体",
    },
  },
} as const;

declare global {
  namespace StarlightApp {
    interface I18n {
      run: string;
      share: string;
      openExamples: string;
      copyShareLink: string;
      shareAccessNotice: string;
      shareLinkCopiedUntil: string;
      shareLinkCopied: string;
      sharing: string;
      cancel: string;
      wasmWaiting: string;
      wasmLoading: string;
      wasmInitializing: string;
      wasmReady: string;
      wasmError: string;
      retry: string;
      sourceCandidates: string;
      saveSaving: string;
      saveSaved: string;
      saveError: string;
      workspaceLabel: string;
      docsHome: string;
      editActions: string;
      stop: string;
      format: string;
      commandSearch: string;
      projectMenu: string;
      openProject: string;
      unnamedProject: string;
      projectCapabilities: string;
      loadingProject: string;
      viewMode: string;
      closeFile: string;
      newFile: string;
      openFiles: string;
      results: string;
      resizePanels: string;
      arrangeSideBySide: string;
      arrangeStacked: string;
      arrangeHorizontal: string;
      arrangeVertical: string;
      noProblems: string;
      projectStatus: string;
      filesCount: string;
      filesCount_one: string;
      filesCount_other: string;
      problemsCount: string;
      problemsCount_one: string;
      problemsCount_other: string;
      fileSize: string;
      examplesGroupBasics: string;
      examplesGroupConfiguration: string;
      examplesGroupAdapters: string;
      examplesGroupValidation: string;
      commandRun: string;
      commandFormat: string;
      commandToggleComment: string;
      commandNextOccurrence: string;
      commandSelectMatches: string;
      commandOpenExamples: string;
      commandToggleExplorer: string;
      commandGoToDefinition: string;
      commandGoToYaml: string;
      commandFindReferences: string;
      commandRenameSymbol: string;
      commandShare: string;
      commandOpenFile: string;
      commandCreateFile: string;
      commandNewProject: string;
      commandShowOutput: string;
      commandShowProblems: string;
      duplicateProject: string;
      deleteProject: string;
      formatSource: string;
      fileTreeLabel: string;
      files: string;
      createFile: string;
      renameFile: string;
      deleteFile: string;
      settings: string;
      colorScheme: string;
      system: string;
      light: string;
      dark: string;
      indentationWidth: string;
      fontSize: string;
      lineWrapping: string;
      lineNumbers: string;
      vim: string;
      examplesTitle: string;
      close: string;
      searchExamples: string;
      searchNameOrCategory: string;
      noExamplesFound: string;
      openFile: string;
      goToFile: string;
      enterFilename: string;
      noFilesFound: string;
      commandPalette: string;
      searchCommand: string;
      noCommandsFound: string;
      editor: string;
      output: string;
      diff: string;
      openExplorer: string;
      closeExplorer: string;
      renameFileFor: string;
      deleteFileFor: string;
      projectName: string;
      renameProjectHint: string;
      editorSurface: string;
      edit: string;
      editorPosition: string;
      deleteFileTitle: string;
      renameFileTitle: string;
      createFileTitle: string;
      deleteFilePrompt: string;
      filePathLabel: string;
      renameSymbolTitle: string;
      renameChangesTitle: string;
      beforeChange: string;
      afterChange: string;
      reenterName: string;
      applyRename: string;
      newName: string;
      reviewRename: string;
      previousOutput: string;
      yamlOutput: string;
      staleOutput: string;
      latestOutput: string;
      clearResourceSelection: string;
      resource: string;
      search: string;
      selectedResourceYaml: string;
      previousYamlOutput: string;
      renderedYamlOutput: string;
      resourceSearch: string;
      searchResources: string;
      noResourcesMatch: string;
      unchanged: string;
      changed: string;
      added: string;
      deleted: string;
      yamlDocument: string;
      projectFolder: string;
      openFolder: string;
      openZip: string;
      exportZip: string;
      importFolder: string;
      importZip: string;
      zipDropZone: string;
      dropZipHere: string;
      projectSizeSummary: string;
      zipRequiredError: string;
      goToDefinitionMissing: string;
      renameSymbolNoTarget: string;
      renameSymbolUnsupportedFiles: string;
      editorNotReady: string;
      renamePreviewInvalid: string;
      renameSourceChanged: string;
      symbolRenamed: string;
      copy: string;
      download: string;
      referencesCount: string;
      draftConflictTitle: string;
      draftConflictDescription: string;
      draftConflictFork: string;
      draftConflictReload: string;
      saveConflict: string;
      referencesLabel: string;
      searchReferences: string;
      searchFilenameOrCode: string;
      noReferencesMatch: string;
      emptyOutput: string;
      documentLabel: string;
      yamlDiff: string;
      allResources: string;
    }
  }
}

const language =
  typeof document === "undefined"
    ? "ja"
    : document.documentElement.lang.toLowerCase().startsWith("en")
      ? "en"
      : "ja";
export const playgroundLocale = language === "en" ? "en-US" : "ja-JP";

void i18n.use(initReactI18next).init({
  resources,
  defaultNS: "starlight",
  lng: language,
  fallbackLng: "ja",
  interpolation: { escapeValue: false },
});

export default i18n;
