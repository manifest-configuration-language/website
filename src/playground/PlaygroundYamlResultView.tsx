import type { RefObject } from "react";
import { Command } from "cmdk";

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
  return (
    <section className="playground-result-content" aria-label={stale ? "前回の結果" : "YAML出力"}>
      <div className="playground-yaml-toolbar">
        <span>{stale ? "前回の結果" : "YAML"}</span>
        <span className={stale ? "playground-result-stale" : "playground-result-status"}>
          {stale ? "古い結果" : "最新"}
        </span>
        {selectedResource && (
          <button type="button" className="playground-resource-clear" onClick={onClearResource}>
            すべて
          </button>
        )}
        <button
          type="button"
          className="playground-resource-toggle"
          aria-pressed={showResources}
          onClick={onToggleResources}
          disabled={resources.length === 0}
        >
          {selectedResource?.label ?? "リソース"}
        </button>
        <button type="button" onClick={onSearch}>
          検索
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
            ? `${selectedResource.label}のYAML結果`
            : stale
              ? "前回のYAML結果"
              : "レンダリング結果"
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
  return (
    <div className="playground-resource-browser" hidden={hidden}>
      <Command label="リソース検索" loop>
        <Command.Input aria-label="リソース検索" placeholder="リソースを検索" />
        <Command.List>
          <Command.Empty>一致するリソースはありません</Command.Empty>
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
                      ? "変更なし"
                      : "変更"
                    : resource.current
                      ? "追加"
                      : "削除"
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
  if (resources.length < 2) return null;
  return (
    <nav className="yaml-document-nav" aria-label="YAML文書" hidden={hidden}>
      {resources.map((resource) => (
        <button type="button" key={resource.key} onClick={() => onSelect(resource.line)}>
          {resource.label}
        </button>
      ))}
    </nav>
  );
}
