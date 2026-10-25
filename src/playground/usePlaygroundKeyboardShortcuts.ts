import { useEffect, type Dispatch, type SetStateAction } from "react";

type MobileView = "editor" | "output" | "problems";

type Options = {
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setQuickOpen: Dispatch<SetStateAction<boolean>>;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setMobileView: Dispatch<SetStateAction<MobileView>>;
  setShowProblems: (show: boolean) => void;
  setShowDiff: (show: boolean) => void;
};

export function usePlaygroundKeyboardShortcuts({
  setCommandPaletteOpen,
  setQuickOpen,
  setExplorerOpen,
  setMobileView,
  setShowProblems,
  setShowDiff,
}: Options) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setExplorerOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setMobileView("problems");
        setShowProblems(true);
        setShowDiff(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    setCommandPaletteOpen,
    setExplorerOpen,
    setMobileView,
    setQuickOpen,
    setShowDiff,
    setShowProblems,
  ]);
}
