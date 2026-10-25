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
      showOutput: "Expand results",
      hideOutput: "Collapse results",
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
      shortcuts: "Keyboard shortcuts",
      shortcutCommandPalette: "Command search",
      shortcutQuickOpen: "Open file",
      shortcutToggleExplorer: "Toggle file explorer",
      shortcutShowProblems: "Show problems",
      shortcutPressKey: "Press a shortcut",
      shortcutInvalid: "That shortcut cannot be used",
      shortcutDuplicate: "That shortcut is already assigned",
      shortcutReset: "Reset shortcuts",
      removeUnreachableDefinition: "Remove unreachable definition",
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
      noResources: "No resources",
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
      projectDropZone: "Project import drop zone",
      dropProjectHere: "Drop files, folders, or a ZIP",
      projectSizeSummary: "{{size}} / {{limit}}",
      dropZipMustBeAloneError: "Drop a ZIP by itself.",
      dropEmptyError: "No project files were found.",
      dropImportError: "Could not read the dropped files.",
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
      draftDiscardTitle: "Discard local draft changes?",
      draftDiscardDescription: "This replaces the changes in this tab with the latest saved draft.",
      draftDiscardCancel: "Keep editing",
      draftDiscardConfirm: "Discard and reload",
      exampleLoadError: "Could not load example: {{title}}",
      exampleInvalidFormat: "The example has an invalid format: {{title}}",
      sharedProjectTooLarge:
        "The shared project exceeds the expanded size limit. Ask the sender to reduce its size.",
      defaultProjectName: "Untitled project",
      importedProjectName: "Imported project",
      sharedProjectName: "Shared project",
      openImportedProject: "Open imported project: {{name}}",
      projectUnavailable: "Could not load project",
      projectCopyName: "Copy of {{name}}",
      zipExported: "ZIP exported",
      yamlCopied: "YAML copied",
      deleteProjectTitle: "Delete project?",
      deleteProjectDescription: "Delete {{name}} and its local draft?",
      projectFileUnavailable: "No selectable file is available",
      projectFileNotEditable: "No editable file is available",
      projectFilePathInvalid: "The file path is invalid",
      projectFileLimit: "A project can contain up to {{count}} files",
      projectRenameStale: "The project changed. Rename the file again.",
      projectImportTargetMissing: "Import edit target not found: {{path}}",
      projectImportRangeInvalid: "Import edit range is invalid: {{path}}",
      projectFileMissing: "File not found",
      archiveSizeLimit: "ZIP file limit: {{size}} MiB",
      archiveEntryLimit: "ZIP entry limit: {{count}}",
      archiveEmpty: "The ZIP file contains no files",
      archiveFileLimit: "Project file limit: {{count}}",
      archiveInvalidPath: "The ZIP file contains an invalid path",
      archiveDuplicatePath: "The ZIP file contains a duplicate path",
      archivePathCollision: "The ZIP file contains colliding paths",
      archiveInvalidDirectory: "The ZIP file contains an invalid or duplicate directory",
      archiveFileDirectoryCollision: "A ZIP file and directory path conflict",
      archiveInvalidSize: "The ZIP file contains invalid size information",
      projectSizeLimit: "Project size limit: {{size}} MiB",
      archiveMainRequired: "The ZIP root must contain main.mcl",
      projectStructureInvalid: "The project file structure is invalid",
      shareSnapshotInvalid: "The shared project format is invalid",
      shareResponseNotJSON: "The share API returned a non-JSON response",
      shareResponseTooLarge: "The share API response exceeds the size limit",
      shareResponseUnreadable: "The share API response could not be read",
      shareSizeLimit: "The shared project exceeds the size limit",
      shareRateLimit: "Too many share links were created. Try again later.",
      shareCreateFailed: "Could not create a share link (HTTP {{status}})",
      shareResponseInvalid: "The share API response format is invalid",
      shareIDInvalid: "The share link ID is invalid",
      shareNotFound: "The share link was not found or has expired",
      shareLoadFailed: "Could not load the shared project (HTTP {{status}})",
      snippetLetLabel: "let declaration",
      snippetEmitLabel: "emit statement",
      snippetConfigMapLabel: "ConfigMap resource",
      snippetDetail: "MCL snippet",
      standardLibraryReference: "Standard library reference",
      sourceSizeLimit: "MCL source limit: {{size}} KiB",
      projectFileSizeLimit: "File size limit: {{size}} MiB",
      projectTooManyFiles: "A project can contain up to {{count}} files",
      projectActivePathInvalid: "The selected file is unavailable",
      projectSizeMetadataInvalid: "Project size information is invalid",
      projectPathsInvalid: "The project contains an invalid file path",
      projectPathsOverlap: "File and directory paths overlap",
      projectUpdateFailed: "Could not update the project",
      fileContentsLabel: "{{path}} contents",
      clusterScopeLabel: "Cluster-scoped",
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
      showOutput: "結果を展開",
      hideOutput: "結果を折りたたむ",
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
      shortcuts: "キーボードショートカット",
      shortcutCommandPalette: "コマンド検索",
      shortcutQuickOpen: "ファイルを開く",
      shortcutToggleExplorer: "ファイル一覧の表示切替",
      shortcutShowProblems: "問題を表示",
      shortcutPressKey: "キーを押してください",
      shortcutInvalid: "このキーの組み合わせは使用できません",
      shortcutDuplicate: "このショートカットはすでに割り当てられています",
      shortcutReset: "初期設定に戻す",
      removeUnreachableDefinition: "到達不能な定義を削除",
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
      noResources: "リソースはありません",
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
      projectDropZone: "プロジェクトのドロップ領域",
      dropProjectHere: "ファイル・フォルダー・ZIPをドロップ",
      projectSizeSummary: "{{size}} / {{limit}}",
      dropZipMustBeAloneError: "ZIPは単独でドロップしてください。",
      dropEmptyError: "プロジェクトファイルが見つかりませんでした。",
      dropImportError: "ドロップしたファイルを読み込めませんでした。",
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
      draftDiscardTitle: "このタブの変更を破棄しますか？",
      draftDiscardDescription: "このタブの内容を最新の保存済みドラフトで置き換えます。",
      draftDiscardCancel: "編集を続ける",
      draftDiscardConfirm: "破棄して再読み込み",
      exampleLoadError: "サンプルを読み込めません: {{title}}",
      exampleInvalidFormat: "サンプルの形式が正しくありません: {{title}}",
      sharedProjectTooLarge:
        "共有プロジェクトの展開サイズが上限を超えています。送信者に内容を小さくしてもらってください。",
      defaultProjectName: "無題のプロジェクト",
      importedProjectName: "インポートしたプロジェクト",
      sharedProjectName: "共有プロジェクト",
      openImportedProject: "読み込んだプロジェクト「{{name}}」を開く",
      projectUnavailable: "プロジェクトを読み込めません",
      projectCopyName: "{{name}}のコピー",
      zipExported: "ZIPを書き出しました",
      yamlCopied: "YAMLをコピーしました",
      deleteProjectTitle: "プロジェクトを削除しますか？",
      deleteProjectDescription: "{{name}}とローカルドラフトを削除します。",
      projectFileUnavailable: "選択できるファイルがありません",
      projectFileNotEditable: "編集できるファイルがありません",
      projectFilePathInvalid: "使用できないファイルパスです",
      projectFileLimit: "プロジェクトのファイル数は{{count}}件までです",
      projectRenameStale: "プロジェクトが変更されました。もう一度ファイル名を変更してください。",
      projectImportTargetMissing: "importの編集対象が見つかりません: {{path}}",
      projectImportRangeInvalid: "importの編集位置を適用できません: {{path}}",
      projectFileMissing: "ファイルが見つかりません",
      archiveSizeLimit: "ZIPファイルの上限は{{size}} MiBです",
      archiveEntryLimit: "ZIPファイルの上限は{{count}}エントリーです",
      archiveEmpty: "ZIPファイルにファイルがありません",
      archiveFileLimit: "プロジェクトの上限は{{count}}ファイルです",
      archiveInvalidPath: "ZIPファイルに無効なパスがあります",
      archiveDuplicatePath: "ZIPファイルに重複したパスがあります",
      archivePathCollision: "ZIPファイルに重複または衝突するパスがあります",
      archiveInvalidDirectory: "ZIPファイルに無効または重複したディレクトリがあります",
      archiveFileDirectoryCollision: "ZIPファイル内でファイルとディレクトリのパスが衝突しています",
      archiveInvalidSize: "ZIPファイルのサイズ情報が無効です",
      projectSizeLimit: "プロジェクトの上限は{{size}} MiBです",
      archiveMainRequired: "ZIPファイルのルートにmain.mclが必要です",
      projectStructureInvalid: "プロジェクトのファイル構成が無効です",
      shareSnapshotInvalid: "共有プロジェクトの形式が正しくありません",
      shareResponseNotJSON: "共有APIからJSON以外の応答が返りました",
      shareResponseTooLarge: "共有APIの応答サイズが上限を超えています",
      shareResponseUnreadable: "共有APIの応答を読み込めませんでした",
      shareSizeLimit: "共有プロジェクトのサイズが上限を超えています",
      shareRateLimit: "共有リンクの作成回数が上限に達しました。時間をおいて再試行してください。",
      shareCreateFailed: "共有リンクを作成できませんでした（HTTP {{status}}）",
      shareResponseInvalid: "共有APIの応答形式が正しくありません",
      shareIDInvalid: "共有リンクのIDが正しくありません",
      shareNotFound: "共有リンクが見つからないか、期限が切れています",
      shareLoadFailed: "共有プロジェクトを読み込めませんでした（HTTP {{status}}）",
      snippetLetLabel: "let宣言",
      snippetEmitLabel: "emit文",
      snippetConfigMapLabel: "ConfigMapリソース",
      snippetDetail: "MCLスニペット",
      standardLibraryReference: "標準関数リファレンス",
      sourceSizeLimit: "MCLソースの上限は{{size}} KiBです",
      projectFileSizeLimit: "各ファイルの上限は{{size}} MiBです",
      projectTooManyFiles: "プロジェクトのファイル数は{{count}}件までです",
      projectActivePathInvalid: "選択中のファイルが使用できません",
      projectSizeMetadataInvalid: "プロジェクトのサイズ情報が正しくありません",
      projectPathsInvalid: "使用できないファイルパスです",
      projectPathsOverlap: "ファイルとディレクトリのパスが重複しています",
      projectUpdateFailed: "プロジェクトを更新できません",
      fileContentsLabel: "{{path}}の内容",
      clusterScopeLabel: "クラスタースコープ",
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
      showOutput: string;
      hideOutput: string;
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
      shortcuts: string;
      shortcutCommandPalette: string;
      shortcutQuickOpen: string;
      shortcutToggleExplorer: string;
      shortcutShowProblems: string;
      shortcutPressKey: string;
      shortcutInvalid: string;
      shortcutDuplicate: string;
      shortcutReset: string;
      removeUnreachableDefinition: string;
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
      noResources: string;
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
      projectDropZone: string;
      dropProjectHere: string;
      projectSizeSummary: string;
      dropZipMustBeAloneError: string;
      dropEmptyError: string;
      dropImportError: string;
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
      draftDiscardTitle: string;
      draftDiscardDescription: string;
      draftDiscardCancel: string;
      draftDiscardConfirm: string;
      exampleLoadError: string;
      exampleInvalidFormat: string;
      sharedProjectTooLarge: string;
      defaultProjectName: string;
      importedProjectName: string;
      sharedProjectName: string;
      openImportedProject: string;
      projectUnavailable: string;
      projectCopyName: string;
      zipExported: string;
      yamlCopied: string;
      deleteProjectTitle: string;
      deleteProjectDescription: string;
      projectFileUnavailable: string;
      projectFileNotEditable: string;
      projectFilePathInvalid: string;
      projectFileLimit: string;
      projectRenameStale: string;
      projectImportTargetMissing: string;
      projectImportRangeInvalid: string;
      projectFileMissing: string;
      archiveSizeLimit: string;
      archiveEntryLimit: string;
      archiveEmpty: string;
      archiveFileLimit: string;
      archiveInvalidPath: string;
      archiveDuplicatePath: string;
      archivePathCollision: string;
      archiveInvalidDirectory: string;
      archiveFileDirectoryCollision: string;
      archiveInvalidSize: string;
      projectSizeLimit: string;
      archiveMainRequired: string;
      projectStructureInvalid: string;
      shareSnapshotInvalid: string;
      shareResponseNotJSON: string;
      shareResponseTooLarge: string;
      shareResponseUnreadable: string;
      shareSizeLimit: string;
      shareRateLimit: string;
      shareCreateFailed: string;
      shareResponseInvalid: string;
      shareIDInvalid: string;
      shareNotFound: string;
      shareLoadFailed: string;
      snippetLetLabel: string;
      snippetEmitLabel: string;
      snippetConfigMapLabel: string;
      snippetDetail: string;
      standardLibraryReference: string;
      sourceSizeLimit: string;
      projectFileSizeLimit: string;
      projectTooManyFiles: string;
      projectActivePathInvalid: string;
      projectSizeMetadataInvalid: string;
      projectPathsInvalid: string;
      projectPathsOverlap: string;
      projectUpdateFailed: string;
      fileContentsLabel: string;
      clusterScopeLabel: string;
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
