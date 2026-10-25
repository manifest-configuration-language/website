import { useMemo, useState, type RefObject } from "react";
import {
  Button,
  Disclosure,
  DisclosureGroup,
  DisclosurePanel,
  Heading,
  Input,
  SearchField,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { parseDocument } from "yaml";

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
          <Button className="playground-resource-clear" onPress={onClearResource}>
            {t("clearResourceSelection")}
          </Button>
        )}
        <Button
          className="playground-resource-toggle"
          aria-pressed={showResources}
          onPress={onToggleResources}
          isDisabled={resources.length === 0}
        >
          {selectedResource?.label ?? t("resource")}
        </Button>
        <Button onPress={onSearch}>{t("search")}</Button>
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
  const [query, setQuery] = useState("");
  const clusterScopeLabel = t("clusterScopeLabel") as string;
  const groups = useMemo(
    () => groupResources(resources, clusterScopeLabel),
    [clusterScopeLabel, resources],
  );
  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return groups;
    return groups
      .map((group) => ({
        ...group,
        resources: group.resources.filter((resource) =>
          [resource.label, resource.kind, resource.namespace, resource.apiVersion]
            .filter(Boolean)
            .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
        ),
      }))
      .filter((group) => group.resources.length > 0);
  }, [groups, query]);
  return (
    <div className="playground-resource-browser" hidden={hidden}>
      <SearchField
        aria-label={t("resourceSearch")}
        className="playground-resource-search"
        value={query}
        onChange={setQuery}
      >
        <Input placeholder={t("searchResources")} />
        {query && (
          <Button aria-label={t("close")} onPress={() => setQuery("")}>
            ×
          </Button>
        )}
      </SearchField>
      {visibleGroups.length === 0 ? (
        <p className="playground-resource-empty">{t("noResourcesMatch")}</p>
      ) : (
        <DisclosureGroup
          className="playground-resource-groups"
          aria-label={t("resource")}
          defaultExpandedKeys={new Set(visibleGroups.map((group) => group.key))}
        >
          {visibleGroups.map((group) => (
            <Disclosure key={group.key} id={group.key} className="playground-resource-group">
              <Heading className="playground-resource-group-heading" level={3}>
                <Button slot="trigger" className="playground-resource-group-trigger">
                  <span>{group.kind}</span>
                  <span className="playground-resource-details">{group.namespace}</span>
                </Button>
              </Heading>
              <DisclosurePanel className="playground-resource-group-items">
                {group.resources.map((resource) => (
                  <Button
                    key={resource.key}
                    className="playground-resource-item"
                    onPress={() => onSelect(resource)}
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
                        : resource.apiVersion}
                    </span>
                  </Button>
                ))}
              </DisclosurePanel>
            </Disclosure>
          ))}
        </DisclosureGroup>
      )}
    </div>
  );
}

type GroupedResource = YamlResource & { kind: string };
type ResourceGroup = {
  key: string;
  kind: string;
  namespace: string;
  resources: GroupedResource[];
};

function groupResources(resources: YamlResource[], clusterScopeLabel: string): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const resource of resources) {
    const data = resource.current?.yaml ?? resource.previous?.yaml ?? resource.yaml;
    let yamlKind: unknown;
    try {
      yamlKind = parseDocument(data, { schema: "core", stringKeys: true }).get("kind");
    } catch {
      yamlKind = undefined;
    }
    const kind = resource.label.includes("/")
      ? resource.label.slice(0, resource.label.indexOf("/"))
      : typeof yamlKind === "string" && yamlKind.length > 0
        ? yamlKind
        : resource.label;
    const namespace = resource.namespace || clusterScopeLabel;
    const key = JSON.stringify([kind, namespace]);
    const groupedResource = { ...resource, kind };
    const group = groups.get(key);
    if (group) group.resources.push(groupedResource);
    else groups.set(key, { key, kind, namespace, resources: [groupedResource] });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      resources: group.resources.toSorted((left, right) => left.label.localeCompare(right.label)),
    }))
    .toSorted((left, right) =>
      `${left.kind}\0${left.namespace}`.localeCompare(`${right.kind}\0${right.namespace}`),
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
        <Button key={resource.key} onPress={() => onSelect(resource.line)}>
          {resource.label}
        </Button>
      ))}
    </nav>
  );
}
