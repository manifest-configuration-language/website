import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
} from "react";
import { useTranslation } from "react-i18next";
import type { LoadedProject } from "./types";
import { projectLimits } from "./projectValidation.js";
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

  async function loadFiles(selected: File[], fromArchive = false) {
    if (!selected.length) return;
    const currentSelection = ++selection.current;
    setLoading(true);
    onLoading(true);
    try {
      const files = fromArchive ? await readProjectArchive(selected[0]) : selected;
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

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled || loading) return;
    const files = [...event.dataTransfer.files];
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith(".zip")) {
      onError(t("zipRequiredError"));
      return;
    }
    void loadFiles(files, true);
  }

  return (
    <section className="playground-project-files" aria-label={t("projectFolder")}>
      <div className="playground-project-file-actions">
        <button
          type="button"
          onClick={() => directoryInput.current?.click()}
          disabled={disabled || loading}
        >
          {t("openFolder")}
        </button>
        <button
          type="button"
          onClick={() => archiveInput.current?.click()}
          disabled={disabled || loading}
        >
          {t("openZip")}
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={disabled || loading || fileCount === 0}
        >
          {t("exportZip")}
        </button>
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
        onDrop={handleDrop}
        aria-label={t("zipDropZone")}
      >
        <span className="playground-project-dropzone-icon" aria-hidden="true">
          ↓
        </span>
        <span>{t("dropZipHere")}</span>
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
