import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { PlaygroundShortcuts } from "./keyboardShortcuts";
import { matchesShortcut } from "./keyboardShortcuts";

type MobileView = "editor" | "output" | "problems";

type Options = {
  shortcuts: PlaygroundShortcuts;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setQuickOpen: Dispatch<SetStateAction<boolean>>;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setMobileView: Dispatch<SetStateAction<MobileView>>;
  setShowProblems: (show: boolean) => void;
  setShowDiff: (show: boolean) => void;
};

export function usePlaygroundKeyboardShortcuts({
  shortcuts,
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
      if (matchesShortcut(event, shortcuts.commandPalette)) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (matchesShortcut(event, shortcuts.quickOpen)) {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }
      if (matchesShortcut(event, shortcuts.toggleExplorer)) {
        event.preventDefault();
        setExplorerOpen((value) => !value);
        return;
      }
      if (matchesShortcut(event, shortcuts.showProblems)) {
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
    shortcuts,
  ]);
}
