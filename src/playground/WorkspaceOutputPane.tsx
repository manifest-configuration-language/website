import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  children: ReactNode;
  showProblems: boolean;
  diagnosticsCount: number;
  onShowProblemsChange: (show: boolean) => void;
  showDiff: boolean;
  onShowDiffChange: (show: boolean) => void;
  showReferences: boolean;
  referenceCount: number;
  onCloseReferences: () => void;
  onOpenReferences: () => void;
  canCopyOutput: boolean;
  canDownloadOutput: boolean;
  canShowDiff: boolean;
  onCopyOutput: () => void;
  onDownloadOutput: () => void;
  orientation: "horizontal" | "vertical";
  onToggleOrientation: () => void;
};

export function WorkspaceOutputPane({
  children,
  showProblems,
  diagnosticsCount,
  onShowProblemsChange,
  showDiff,
  onShowDiffChange,
  showReferences,
  referenceCount,
  onCloseReferences,
  onOpenReferences,
  canCopyOutput,
  canDownloadOutput,
  canShowDiff,
  onCopyOutput,
  onDownloadOutput,
  orientation,
  onToggleOrientation,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="playground-result-panel">
      <div className="playground-result-toolbar">
        <div className="playground-result-tabs" role="group" aria-label={t("results")}>
          <button
            type="button"
            aria-pressed={!showProblems && !showDiff && !showReferences}
            onClick={() => {
              onCloseReferences();
              onShowProblemsChange(false);
              onShowDiffChange(false);
            }}
          >
            YAML
          </button>
          <button
            type="button"
            aria-pressed={!showReferences && showProblems}
            onClick={() => {
              onCloseReferences();
              onShowProblemsChange(true);
              onShowDiffChange(false);
            }}
          >
            {t("problemsCount", { count: diagnosticsCount })}
          </button>
          <button
            type="button"
            aria-pressed={!showReferences && showDiff}
            onClick={() => {
              onCloseReferences();
              onShowProblemsChange(false);
              onShowDiffChange(true);
            }}
            disabled={!canShowDiff}
          >
            {t("diff")}
          </button>
          {showReferences && (
            <button type="button" aria-pressed="true" onClick={onOpenReferences}>
              {t("referencesCount", { count: referenceCount })}
            </button>
          )}
        </div>
        <button type="button" onClick={onCopyOutput} disabled={!canCopyOutput}>
          {t("copy")}
        </button>
        <button type="button" onClick={onDownloadOutput} disabled={!canDownloadOutput}>
          {t("download")}
        </button>
        <button
          type="button"
          className="playground-layout-toggle"
          onClick={onToggleOrientation}
          aria-label={orientation === "vertical" ? t("arrangeSideBySide") : t("arrangeStacked")}
          title={orientation === "vertical" ? t("arrangeSideBySide") : t("arrangeStacked")}
        >
          {orientation === "vertical" ? t("arrangeHorizontal") : t("arrangeVertical")}
        </button>
      </div>
      {children}
    </div>
  );
}
