import type { ReactNode } from "react";
import { Button } from "react-aria-components";
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
          <Button
            aria-pressed={!showProblems && !showDiff && !showReferences}
            onPress={() => {
              onCloseReferences();
              onShowProblemsChange(false);
              onShowDiffChange(false);
            }}
          >
            YAML
          </Button>
          <Button
            aria-pressed={!showReferences && showProblems}
            onPress={() => {
              onCloseReferences();
              onShowProblemsChange(true);
              onShowDiffChange(false);
            }}
          >
            {t("problemsCount", { count: diagnosticsCount })}
          </Button>
          <Button
            aria-pressed={!showReferences && showDiff}
            onPress={() => {
              onCloseReferences();
              onShowProblemsChange(false);
              onShowDiffChange(true);
            }}
            isDisabled={!canShowDiff}
          >
            {t("diff")}
          </Button>
          {showReferences && (
            <Button aria-pressed="true" onPress={onOpenReferences}>
              {t("referencesCount", { count: referenceCount })}
            </Button>
          )}
        </div>
        <Button onPress={onCopyOutput} isDisabled={!canCopyOutput}>
          {t("copy")}
        </Button>
        <Button onPress={onDownloadOutput} isDisabled={!canDownloadOutput}>
          {t("download")}
        </Button>
        <Button
          className="playground-layout-toggle"
          onPress={onToggleOrientation}
          aria-label={orientation === "vertical" ? t("arrangeSideBySide") : t("arrangeStacked")}
        >
          {orientation === "vertical" ? t("arrangeHorizontal") : t("arrangeVertical")}
        </Button>
      </div>
      {children}
    </div>
  );
}
