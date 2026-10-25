import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useTranslation } from "react-i18next";
import { ResourceBrowser, type YamlResource } from "./PlaygroundYamlResultView";

type Props = {
  previousYaml: string;
  currentYaml: string;
  fontSize: number;
  resources: YamlResource[];
  selectedResource?: YamlResource;
  showResources: boolean;
  onToggleResources: () => void;
  onSelectResource: (resource: YamlResource) => void;
  onResetResource: () => void;
};

export function PlaygroundDiffResultView({
  previousYaml,
  currentYaml,
  fontSize,
  resources,
  selectedResource,
  showResources,
  onToggleResources,
  onSelectResource,
  onResetResource,
}: Props) {
  const { t } = useTranslation();
  const diffHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = diffHost.current;
    if (!parent) return;
    const readOnly = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.theme({ ".cm-content, .cm-gutters": { fontSize: `${fontSize}px` } }),
    ];
    const previousText = selectedResource ? (selectedResource.previous?.yaml ?? "") : previousYaml;
    const currentText = selectedResource ? (selectedResource.current?.yaml ?? "") : currentYaml;
    const merge = new MergeView({
      a: { doc: previousText, extensions: readOnly },
      b: { doc: currentText, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
    });
    return () => merge.destroy();
  }, [currentYaml, fontSize, previousYaml, selectedResource]);

  return (
    <section className="playground-diff" aria-label={t("yamlDiff")}>
      <div className="playground-diff-labels">
        <span>
          {selectedResource
            ? selectedResource.previous
              ? t("previousOutput")
              : t("added")
            : t("previousOutput")}
        </span>
        <div className="playground-diff-resource-controls">
          <button
            type="button"
            className="playground-diff-resource-toggle"
            aria-pressed={showResources}
            onClick={onToggleResources}
            disabled={resources.length === 0}
          >
            {selectedResource?.label ?? t("allResources")}
          </button>
          {selectedResource && (
            <button
              type="button"
              className="playground-diff-resource-reset"
              onClick={onResetResource}
            >
              {t("allResources")}
            </button>
          )}
        </div>
        <span>
          {selectedResource
            ? selectedResource.current
              ? t("latestOutput")
              : t("deleted")
            : t("latestOutput")}
        </span>
      </div>
      <ResourceBrowser
        resources={resources}
        onSelect={onSelectResource}
        hidden={!showResources}
        showChanges
      />
      <div className="playground-diff-editor" ref={diffHost} hidden={showResources} />
    </section>
  );
}
