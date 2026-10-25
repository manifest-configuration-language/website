import { useState, type Dispatch, type SetStateAction, type SyntheticEvent } from "react";
import type { ProjectMutation } from "./usePlaygroundProject";

export type FileAction = { kind: "create" } | { kind: "rename" | "delete"; path: string };

type Options = {
  createFile: (path: string) => ProjectMutation | Promise<ProjectMutation>;
  renameFile: (path: string, nextPath: string) => Promise<ProjectMutation>;
  deleteFile: (path: string) => ProjectMutation;
  finishProjectMutation: () => void | Promise<void>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setRecentPaths: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string>>;
};

export function usePlaygroundFileActions({
  createFile,
  renameFile,
  deleteFile,
  finishProjectMutation,
  setOpenPaths,
  setRecentPaths,
  setError,
}: Options) {
  const [fileAction, setFileAction] = useState<FileAction>();
  const [filePathInput, setFilePathInput] = useState("");
  const [fileActionError, setFileActionError] = useState("");

  function requestCreateFile() {
    setFilePathInput("");
    setFileActionError("");
    setFileAction({ kind: "create" });
  }

  function requestRenameFile(path: string) {
    setFilePathInput(path);
    setFileActionError("");
    setFileAction({ kind: "rename", path });
  }

  function requestDeleteFile(path: string) {
    setFileActionError("");
    setFileAction({ kind: "delete", path });
  }

  async function submitFileAction(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileAction || fileAction.kind === "delete") return;
    const action = fileAction;
    const path = filePathInput.trim();
    const result = await (action.kind === "create"
      ? createFile(path)
      : renameFile(action.path, path));
    if (!result.ok) {
      setFileActionError(result.error);
      return;
    }
    void finishProjectMutation();
    setOpenPaths((previous) => {
      const next =
        action.kind === "create"
          ? previous
          : previous.map((entry) => (entry === action.path ? path : entry));
      return next.includes(path) ? next : [...next, path];
    });
    setRecentPaths((previous) =>
      action.kind === "create"
        ? [path, ...previous.filter((entry) => entry !== path)]
        : previous.map((entry) => (entry === action.path ? path : entry)),
    );
    setError("");
    setFileActionError("");
    setFileAction(undefined);
  }

  function confirmDeleteFile() {
    if (!fileAction || fileAction.kind !== "delete") return;
    const { path } = fileAction;
    const result = deleteFile(path);
    if (!result.ok) {
      setFileActionError(result.error);
      return;
    }
    setOpenPaths((previous) => {
      const remaining = previous.filter((entry) => entry !== path);
      return remaining.length ? remaining : ["main.mcl"];
    });
    void finishProjectMutation();
    setRecentPaths((previous) => previous.filter((entry) => entry !== path));
    setError("");
    setFileActionError("");
    setFileAction(undefined);
  }

  function closeFileAction() {
    setFileAction(undefined);
  }

  return {
    fileAction,
    fileActionError,
    filePathInput,
    setFilePathInput,
    requestCreateFile,
    requestRenameFile,
    requestDeleteFile,
    submitFileAction,
    confirmDeleteFile,
    closeFileAction,
  };
}
