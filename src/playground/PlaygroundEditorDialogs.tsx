import { useEffect, useRef, type SyntheticEvent } from "react";
import { QuickAccessList, type QuickAccessItem } from "./QuickAccessList";

type FileAction = { kind: "create" } | { kind: "rename" | "delete"; path: string };

type RenamePreviewEntry = {
  path: string;
  line: number;
  before: string;
  after: string;
};

type Props = {
  fileAction?: FileAction;
  fileActionError: string;
  filePathInput: string;
  onFilePathInputChange: (value: string) => void;
  onCloseFileAction: () => void;
  onSubmitFileAction: (event: SyntheticEvent<HTMLFormElement>) => void;
  onConfirmDeleteFile: () => void;
  symbolRenameOpen: boolean;
  hasPendingRename: boolean;
  renamePreview: RenamePreviewEntry[] | undefined;
  symbolRenameError: string;
  symbolRenameInput: string;
  onSymbolRenameInputChange: (value: string) => void;
  onCloseSymbolRename: () => void;
  onResetSymbolRename: () => void;
  onApplySymbolRename: () => void;
  onSubmitSymbolRename: (event: SyntheticEvent<HTMLFormElement>) => void;
  busy: boolean;
  loadingProject: boolean;
  symbolReferencesOpen: boolean;
  symbolReferencesError: string;
  symbolReferenceItems: QuickAccessItem[];
  onCloseSymbolReferences: () => void;
};

export function PlaygroundEditorDialogs({
  fileAction,
  fileActionError,
  filePathInput,
  onFilePathInputChange,
  onCloseFileAction,
  onSubmitFileAction,
  onConfirmDeleteFile,
  symbolRenameOpen,
  hasPendingRename,
  renamePreview,
  symbolRenameError,
  symbolRenameInput,
  onSymbolRenameInputChange,
  onCloseSymbolRename,
  onResetSymbolRename,
  onApplySymbolRename,
  onSubmitSymbolRename,
  busy,
  loadingProject,
  symbolReferencesOpen,
  symbolReferencesError,
  symbolReferenceItems,
  onCloseSymbolReferences,
}: Props) {
  const fileActionDialog = useRef<HTMLDialogElement>(null);
  const symbolRenameDialog = useRef<HTMLDialogElement>(null);
  const symbolReferencesDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = fileActionDialog.current;
    if (!dialog) return;
    if (fileAction && !dialog.open) dialog.showModal();
    else if (!fileAction && dialog.open) dialog.close();
  }, [fileAction]);

  useEffect(() => {
    const dialog = symbolRenameDialog.current;
    if (!dialog) return;
    if (symbolRenameOpen && !dialog.open) dialog.showModal();
    else if (!symbolRenameOpen && dialog.open) dialog.close();
  }, [symbolRenameOpen]);

  useEffect(() => {
    const dialog = symbolReferencesDialog.current;
    if (!dialog) return;
    if (symbolReferencesOpen && !dialog.open) dialog.showModal();
    else if (!symbolReferencesOpen && dialog.open) dialog.close();
  }, [symbolReferencesOpen]);

  return (
    <>
      <dialog
        ref={fileActionDialog}
        className="playground-file-action"
        aria-labelledby="playground-file-action-title"
        onCancel={onCloseFileAction}
      >
        {fileAction?.kind === "delete" ? (
          <>
            <h2 id="playground-file-action-title">ファイルの削除</h2>
            <p>{fileAction.path}を削除しますか？</p>
            {fileActionError && <p role="alert">{fileActionError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={onCloseFileAction}>
                キャンセル
              </button>
              <button
                type="button"
                className="playground-file-action-danger"
                onClick={onConfirmDeleteFile}
              >
                削除
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmitFileAction}>
            <h2 id="playground-file-action-title">
              {fileAction?.kind === "rename" ? "ファイル名の変更" : "新規ファイル"}
            </h2>
            <label>
              <span>ファイルパス</span>
              <input
                autoFocus
                value={filePathInput}
                onChange={(event) => onFilePathInputChange(event.currentTarget.value)}
                placeholder="values.yaml"
                required
                maxLength={512}
              />
            </label>
            {fileActionError && <p role="alert">{fileActionError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={onCloseFileAction}>
                キャンセル
              </button>
              <button type="submit">{fileAction?.kind === "rename" ? "変更" : "作成"}</button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={symbolRenameDialog}
        className="playground-file-action"
        aria-labelledby="playground-symbol-rename-title"
        onCancel={onCloseSymbolRename}
      >
        {hasPendingRename ? (
          <section>
            <h2 id="playground-symbol-rename-title">変更箇所</h2>
            <ul className="playground-symbol-rename-preview">
              {renamePreview?.map((entry, index) => (
                <li key={`${entry.path}:${entry.line}:${index}`}>
                  <span className="playground-symbol-rename-location">
                    {entry.path}:{entry.line}
                  </span>
                  <div className="playground-symbol-rename-change">
                    <del aria-label="変更前">{entry.before}</del>
                    <ins aria-label="変更後">{entry.after}</ins>
                  </div>
                </li>
              ))}
            </ul>
            {symbolRenameError && <p role="alert">{symbolRenameError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={onResetSymbolRename}>
                名前を再入力
              </button>
              <button type="button" disabled={busy || loadingProject} onClick={onApplySymbolRename}>
                名前を変更
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={onSubmitSymbolRename}>
            <h2 id="playground-symbol-rename-title">シンボル名の変更</h2>
            <label>
              <span>新しい名前</span>
              <input
                autoFocus
                value={symbolRenameInput}
                onChange={(event) => onSymbolRenameInputChange(event.currentTarget.value)}
                required
                maxLength={256}
              />
            </label>
            {symbolRenameError && <p role="alert">{symbolRenameError}</p>}
            <div className="playground-file-action-buttons">
              <button type="button" onClick={onCloseSymbolRename}>
                キャンセル
              </button>
              <button type="submit" disabled={busy || loadingProject}>
                変更箇所を確認
              </button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={symbolReferencesDialog}
        className="playground-quick-open"
        aria-labelledby="playground-symbol-references-title"
        onCancel={onCloseSymbolReferences}
      >
        <label id="playground-symbol-references-title">
          <span>参照箇所</span>
        </label>
        {symbolReferencesError ? (
          <p role="alert">{symbolReferencesError}</p>
        ) : (
          <QuickAccessList
            label="参照を検索"
            placeholder="ファイル名またはコードを検索"
            emptyMessage="参照が見つかりません"
            items={symbolReferenceItems}
          />
        )}
        <div className="playground-file-action-buttons">
          <button type="button" onClick={onCloseSymbolReferences}>
            閉じる
          </button>
        </div>
      </dialog>
    </>
  );
}
