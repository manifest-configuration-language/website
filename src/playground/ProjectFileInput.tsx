import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
} from "react";
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
      onError("ZIPファイルを1つドロップしてください。");
      return;
    }
    void loadFiles(files, true);
  }

  return (
    <section className="playground-project-files" aria-label="プロジェクトファイル">
      <div className="playground-project-file-actions">
        <button
          type="button"
          onClick={() => directoryInput.current?.click()}
          disabled={disabled || loading}
        >
          フォルダーを開く
        </button>
        <button
          type="button"
          onClick={() => archiveInput.current?.click()}
          disabled={disabled || loading}
        >
          ZIPを開く
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={disabled || loading || fileCount === 0}
        >
          ZIPを書き出す
        </button>
        <input
          ref={directoryInput}
          className="playground-project-file-picker"
          type="file"
          multiple
          disabled={disabled || loading}
          {...directoryInputProps}
          aria-label="プロジェクトフォルダーを読み込む"
          tabIndex={-1}
          onChange={(event) => void load(event)}
        />
        <input
          ref={archiveInput}
          className="playground-project-file-picker"
          type="file"
          accept=".zip,application/zip"
          disabled={disabled || loading}
          aria-label="プロジェクトZIPを読み込む"
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
        aria-label="ZIPファイルのドロップ領域"
      >
        <span className="playground-project-dropzone-icon" aria-hidden="true">
          ↓
        </span>
        <span>ZIPをここにドロップ</span>
      </div>
      <div className="playground-project-summary" aria-live="polite">
        <span>
          ファイル <strong>{fileCount.toLocaleString()}</strong> 件
        </span>
        <span>
          合計 <strong>{(projectSize / 1024 / 1024).toFixed(1)} MiB</strong> /{" "}
          {projectLimits.projectBytes / (1024 * 1024)} MiB
        </span>
        {loading && <span role="status">読み込み中</span>}
      </div>
    </section>
  );
}
