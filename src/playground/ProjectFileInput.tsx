import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import type { LoadedProject } from "./types";
import { projectLimits } from "./projectValidation.js";
import { readProjectArchive } from "./projectZip";

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
  const [loading, setLoading] = useState(false);

  async function load(event: ChangeEvent<HTMLInputElement>, fromArchive = false) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (!selected?.length) return;
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

  return (
    <>
      <label>
        フォルダーを読み込む
        <input
          type="file"
          multiple
          disabled={disabled || loading}
          {...directoryInputProps}
          aria-label="プロジェクトフォルダーを読み込む"
          onChange={(event) => void load(event)}
        />
      </label>
      <label>
        ZIPを読み込む
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={disabled || loading}
          aria-label="プロジェクトZIPを読み込む"
          onChange={(event) => void load(event, true)}
        />
      </label>
      <button type="button" onClick={() => void onExport()} disabled={disabled || loading}>
        ZIPを書き出す
      </button>
      <span>
        {fileCount} files · {(projectSize / 1024 / 1024).toFixed(1)} /{" "}
        {projectLimits.projectBytes / (1024 * 1024)} MiB
      </span>
      {loading && <span role="status">読み込み中</span>}
    </>
  );
}
