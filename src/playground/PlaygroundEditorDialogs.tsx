import { useTranslation } from "react-i18next";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { SyntheticEvent } from "react";

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
}: Props) {
  const { t } = useTranslation();
  const fileActionTitle =
    fileAction?.kind === "delete"
      ? t("deleteFileTitle")
      : fileAction?.kind === "rename"
        ? t("renameFileTitle")
        : t("createFileTitle");

  return (
    <>
      <ModalOverlay
        className="playground-aria-overlay"
        isOpen={Boolean(fileAction)}
        isDismissable={!busy && !loadingProject}
        onOpenChange={(open) => {
          if (!open) onCloseFileAction();
        }}
      >
        <Modal className="playground-aria-modal">
          <Dialog aria-label={fileActionTitle} className="playground-file-action">
            {fileAction?.kind === "delete" ? (
              <section>
                <Heading slot="title">{t("deleteFileTitle")}</Heading>
                <p>{t("deleteFilePrompt", { path: fileAction.path })}</p>
                {fileActionError && <p role="alert">{fileActionError}</p>}
                <div className="playground-file-action-buttons">
                  <Button type="button" onPress={onCloseFileAction}>
                    {t("cancel")}
                  </Button>
                  <Button
                    type="button"
                    className="playground-file-action-danger"
                    onPress={onConfirmDeleteFile}
                  >
                    {t("deleteFile")}
                  </Button>
                </div>
              </section>
            ) : (
              <form onSubmit={onSubmitFileAction}>
                <Heading slot="title">{fileActionTitle}</Heading>
                <label>
                  <span>{t("filePathLabel")}</span>
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
                  <Button type="button" onPress={onCloseFileAction}>
                    {t("cancel")}
                  </Button>
                  <Button type="submit">
                    {fileAction?.kind === "rename" ? t("renameFile") : t("createFile")}
                  </Button>
                </div>
              </form>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ModalOverlay
        className="playground-aria-overlay"
        isOpen={symbolRenameOpen}
        isDismissable={!busy && !loadingProject}
        onOpenChange={(open) => {
          if (!open) onCloseSymbolRename();
        }}
      >
        <Modal className="playground-aria-modal">
          <Dialog aria-label={t("renameSymbolTitle")} className="playground-file-action">
            {hasPendingRename ? (
              <section>
                <Heading slot="title">{t("renameChangesTitle")}</Heading>
                <ul className="playground-symbol-rename-preview">
                  {renamePreview?.map((entry, index) => (
                    <li key={`${entry.path}:${entry.line}:${index}`}>
                      <span className="playground-symbol-rename-location">
                        {entry.path}:{entry.line}
                      </span>
                      <div className="playground-symbol-rename-change">
                        <del aria-label={t("beforeChange")}>{entry.before}</del>
                        <ins aria-label={t("afterChange")}>{entry.after}</ins>
                      </div>
                    </li>
                  ))}
                </ul>
                {symbolRenameError && <p role="alert">{symbolRenameError}</p>}
                <div className="playground-file-action-buttons">
                  <Button type="button" onPress={onResetSymbolRename}>
                    {t("reenterName")}
                  </Button>
                  <Button
                    type="button"
                    isDisabled={busy || loadingProject}
                    onPress={onApplySymbolRename}
                  >
                    {t("applyRename")}
                  </Button>
                </div>
              </section>
            ) : (
              <form onSubmit={onSubmitSymbolRename}>
                <Heading slot="title">{t("renameSymbolTitle")}</Heading>
                <label>
                  <span>{t("newName")}</span>
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
                  <Button type="button" onPress={onCloseSymbolRename}>
                    {t("cancel")}
                  </Button>
                  <Button type="submit" isDisabled={busy || loadingProject}>
                    {t("reviewRename")}
                  </Button>
                </div>
              </form>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
