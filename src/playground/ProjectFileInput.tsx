import { useRef, type ChangeEvent, type InputHTMLAttributes } from "react";
import type { LoadedProject } from "./types";
import { projectLimits } from "./projectValidation.js";

const directoryInputProps = {
  webkitdirectory: "",
} as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string };

type Props = {
  fileCount: number;
  projectSize: number;
  onLoad: (files: File[]) => Promise<LoadedProject>;
  onLoaded: (project: LoadedProject) => void;
  onError: (message: string) => void;
  disabled?: boolean;
};

export function ProjectFileInput({
  fileCount,
  projectSize,
  onLoad,
  onLoaded,
  onError,
  disabled = false,
}: Props) {
  const selection = useRef(0);

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (!selected?.length) return;
    const currentSelection = ++selection.current;
    try {
      const project = await onLoad(selected);
      if (currentSelection === selection.current) onLoaded(project);
    } catch (cause) {
      if (currentSelection === selection.current)
        onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <label>
        プロジェクトフォルダーを読み込む
        <input
          type="file"
          multiple
          disabled={disabled}
          {...directoryInputProps}
          aria-label="MCLプロジェクトフォルダー"
          onChange={load}
        />
      </label>
      <span>
        {fileCount} files · {(projectSize / 1024 / 1024).toFixed(1)} /{" "}
        {projectLimits.projectBytes / (1024 * 1024)} MiB
      </span>
    </>
  );
}
