import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
} from "react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { LoadedProject } from "./types";
import { projectLimits } from "./projectValidation.js";
import { ProjectDropError, readProjectDrop } from "./projectDrop";
import { readProjectArchive } from "./projectZip";
import "./ProjectFileInput.css";

const directoryInputProps = {
  webkitdirectory: "",
} as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string };

type Props = {
  fileCount: number;
  projectSize: number;
  onLoad: (files: File[]) => Promise<LoadedProject>;
  onLoaded: (project: LoadedProject) => void;
  onError: (message: string) => void;
  onLoading: (loading: boolean) => void;
  onExport: () => Promise<void>;
  disabled?: boolean;
};

export function ProjectFileInput({
  fileCount,
  projectSize,
  onLoad,
  onLoaded,
  onError,
  onLoading,
  onExport,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const selection = useRef(0);
  const directoryInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function loadFiles(selected: File[], fromArchive = false, reservedSelection?: number) {
    if (!selected.length) return;
    const currentSelection = reservedSelection ?? ++selection.current;
    if (currentSelection !== selection.current) return;
    setLoading(true);
    onLoading(true);
    try {
      const files = fromArchive ? await readProjectArchive(selected[0], t) : selected;
      const project = await onLoad(files);
      if (currentSelection === selection.current) onLoaded(project);
    } catch (cause) {
      if (currentSelection === selection.current)
        onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentSelection === selection.current) {
        setLoading(false);
        onLoading(false);
      }
    }
  }

  async function load(event: ChangeEvent<HTMLInputElement>, fromArchive = false) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    await loadFiles(selected, fromArchive);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled && !loading) setDragging(true);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled || loading) return;
    const currentSelection = ++selection.current;
    try {
      const imported = await readProjectDrop(event.dataTransfer, projectLimits.projectFiles);
      if (currentSelection !== selection.current) return;
      await loadFiles(imported.files, imported.archive, currentSelection);
    } catch (cause) {
      if (currentSelection !== selection.current) return;
      onError(
        cause instanceof ProjectDropError
          ? cause.code === "tooManyFiles"
            ? t("projectTooManyFiles", { count: projectLimits.projectFiles })
            : cause.code === "zipMustBeAlone"
              ? t("dropZipMustBeAloneError")
              : t("dropEmptyError")
          : t("dropImportError"),
      );
    }
  }

  return (
    <section className="playground-project-files" aria-label={t("projectFolder")}>
      <div className="playground-project-file-actions">
        <Button onPress={() => directoryInput.current?.click()} isDisabled={disabled || loading}>
          {t("openFolder")}
        </Button>
        <Button onPress={() => archiveInput.current?.click()} isDisabled={disabled || loading}>
          {t("openZip")}
        </Button>
        <Button onPress={() => void onExport()} isDisabled={disabled || loading || fileCount === 0}>
          {t("exportZip")}
        </Button>
        <input
          ref={directoryInput}
          className="playground-project-file-picker"
          type="file"
          multiple
          disabled={disabled || loading}
          {...directoryInputProps}
          aria-label={t("importFolder")}
          tabIndex={-1}
          onChange={(event) => void load(event)}
        />
        <input
          ref={archiveInput}
          className="playground-project-file-picker"
          type="file"
          accept=".zip,application/zip"
          disabled={disabled || loading}
          aria-label={t("importZip")}
          tabIndex={-1}
          onChange={(event) => void load(event, true)}
        />
      </div>
      <div
        className={`playground-project-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void handleDrop(event)}
        aria-label={t("projectDropZone")}
      >
        <span className="playground-project-dropzone-icon" aria-hidden="true">
          ↓
        </span>
        <span>{t("dropProjectHere")}</span>
      </div>
      <div className="playground-project-summary" aria-live="polite">
        <span>{t("filesCount", { count: fileCount })}</span>
        <span>
          {t("projectSizeSummary", {
            size: t("fileSize", { size: (projectSize / 1024 / 1024).toFixed(1) }),
            limit: t("fileSize", { size: projectLimits.projectBytes / (1024 * 1024) }),
          })}
        </span>
        {loading && <span role="status">{t("loadingProject")}</span>}
      </div>
    </section>
  );
}
