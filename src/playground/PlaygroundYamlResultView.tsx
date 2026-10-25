import type { RefObject } from "react";
import { Command } from "cmdk";
import { useTranslation } from "react-i18next";

export type YamlResource = {
  key: string;
  label: string;
  apiVersion?: string;
  namespace?: string;
  line: number;
  yaml: string;
  outputStartOffset: number;
  outputEndOffset: number;
  previous?: YamlResource;
  current?: YamlResource;
};

type Props = {
  stale: boolean;
  resources: YamlResource[];
  selectedResource?: YamlResource;
  showResources: boolean;
  outputHost: RefObject<HTMLDivElement | null>;
  onToggleResources: () => void;
  onSelectResource: (resource: YamlResource) => void;
  onClearResource: () => void;
  onSearch: () => void;
  onGoToDocument: (line: number) => void;
};

export function PlaygroundYamlResultView({
  stale,
  resources,
  selectedResource,
  showResources,
  outputHost,
  onToggleResources,
  onSelectResource,
  onClearResource,
  onSearch,
  onGoToDocument,
}: Props) {
  const { t } = useTranslation();
  return (
    <section
      className="playground-result-content"
      aria-label={t(stale ? "previousOutput" : "yamlOutput")}
    >
      <div className="playground-yaml-toolbar">
        <span>{stale ? t("previousOutput") : t("yamlOutput")}</span>
        <span className={stale ? "playground-result-stale" : "playground-result-status"}>
          {stale ? t("staleOutput") : t("latestOutput")}
        </span>
        {selectedResource && (
          <button type="button" className="playground-resource-clear" onClick={onClearResource}>
            {t("clearResourceSelection")}
          </button>
        )}
        <button
          type="button"
          className="playground-resource-toggle"
          aria-pressed={showResources}
          onClick={onToggleResources}
          disabled={resources.length === 0}
        >
          {selectedResource?.label ?? t("resource")}
        </button>
        <button type="button" onClick={onSearch}>
          {t("search")}
        </button>
      </div>
      <ResourceBrowser resources={resources} onSelect={onSelectResource} hidden={!showResources} />
      {!selectedResource && (
        <YamlNavigation resources={resources} onSelect={onGoToDocument} hidden={showResources} />
      )}
      <div
        className="playground-output"
        aria-label={
          selectedResource
            ? t("selectedResourceYaml", { label: selectedResource.label })
            : stale
              ? t("previousYamlOutput")
              : t("renderedYamlOutput")
        }
        hidden={showResources}
        ref={outputHost}
      />
    </section>
  );
}

export function ResourceBrowser({
  resources,
  onSelect,
  hidden,
  showChanges = false,
}: {
  resources: YamlResource[];
  onSelect: (resource: YamlResource) => void;
  hidden: boolean;
  showChanges?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="playground-resource-browser" hidden={hidden}>
      <Command label={t("resourceSearch")} loop>
        <Command.Input aria-label={t("resourceSearch")} placeholder={t("searchResources")} />
        <Command.List>
          <Command.Empty>{t("noResourcesMatch")}</Command.Empty>
          {resources.map((resource) => (
            <Command.Item
              key={resource.key}
              value={resource.label}
              keywords={[resource.apiVersion, resource.namespace].filter((value): value is string =>
                Boolean(value),
              )}
              onSelect={() => onSelect(resource)}
            >
              <span className="playground-resource-name">{resource.label}</span>
              <span className="playground-resource-details">
                {showChanges
                  ? resource.previous && resource.current
                    ? resource.previous.yaml === resource.current.yaml
                      ? t("unchanged")
                      : t("changed")
                    : resource.current
                      ? t("added")
                      : t("deleted")
                  : [resource.apiVersion, resource.namespace].filter(Boolean).join(" · ")}
              </span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

function YamlNavigation({
  resources,
  onSelect,
  hidden,
}: {
  resources: YamlResource[];
  onSelect: (line: number) => void;
  hidden: boolean;
}) {
  const { t } = useTranslation();
  if (resources.length < 2) return null;
  return (
    <nav className="yaml-document-nav" aria-label={t("yamlDocument")} hidden={hidden}>
      {resources.map((resource) => (
        <button type="button" key={resource.key} onClick={() => onSelect(resource.line)}>
          {resource.label}
        </button>
      ))}
    </nav>
  );
}
