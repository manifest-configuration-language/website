import { useEffect, useMemo, useRef, useState } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Button, Input, SearchField } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { ProjectFile } from "./types";
import "./ProjectTabs.css";

type Props = {
  paths: string[];
  files: Record<string, ProjectFile>;
  activePath: string;
  onSelect: (path: string) => void;
  onCreate: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  disabled?: boolean;
};

type FileTreeNode = {
  name: string;
  path: string;
  file: boolean;
  selectable: boolean;
  children: string[];
};

const rootItemId = "\u0000project-root";

function createFileTree(paths: string[], files: Record<string, ProjectFile>) {
  const nodes = new Map<string, FileTreeNode>([
    [rootItemId, { name: "", path: "", file: false, selectable: false, children: [] }],
  ]);

  for (const path of paths) {
    const parts = path.split("/");
    let parent = nodes.get(rootItemId)!;
    let nodePath = "";

    for (const [index, name] of parts.entries()) {
      nodePath = nodePath ? `${nodePath}/${name}` : name;
      const isFile = index === parts.length - 1;
      let node = nodes.get(nodePath);
      if (!node) {
        node = {
          name,
          path: nodePath,
          file: isFile,
          selectable: isFile && (nodePath === "main.mcl" || files[nodePath]?.encoding === "utf8"),
          children: [],
        };
        nodes.set(nodePath, node);
        parent.children.push(nodePath);
      }
      parent = node;
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((left, right) => {
      const leftNode = nodes.get(left)!;
      const rightNode = nodes.get(right)!;
      if (leftNode.file !== rightNode.file) return leftNode.file ? 1 : -1;
      return leftNode.name.localeCompare(rightNode.name);
    });
  }

  return nodes;
}

export function ProjectTabs({
  paths,
  files,
  activePath,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const visiblePaths = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? paths.filter((path) => path.toLocaleLowerCase().includes(query)) : paths;
  }, [paths, search]);
  const nodes = useMemo(() => createFileTree(visiblePaths, files), [visiblePaths, files]);
  const expandedItems = useMemo(
    () => [...nodes.values()].filter((node) => !node.file).map((node) => node.path || rootItemId),
    [nodes],
  );
  const previousFolders = useRef(new Set(expandedItems));
  const tree = useTree<FileTreeNode>({
    rootItemId,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => !item.getItemData().file,
    dataLoader: {
      getItem: (itemId) => nodes.get(itemId)!,
      getChildren: (itemId) => nodes.get(itemId)?.children ?? [],
    },
    initialState: { expandedItems },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
    onPrimaryAction(item) {
      const node = item.getItemData();
      if (node.file) {
        if (!disabled && node.selectable) onSelect(node.path);
      } else if (item.isExpanded()) {
        item.collapse();
      } else {
        item.expand();
      }
    },
  });

  useEffect(() => {
    tree.rebuildTree();
    const folders = new Set(expandedItems);
    for (const folder of folders) {
      if (search.trim() || !previousFolders.current.has(folder))
        tree.getItemInstance(folder).expand();
    }
    previousFolders.current = folders;
  }, [tree, nodes, expandedItems, search]);

  return (
    <nav className="project-explorer" aria-label={t("fileTreeLabel")}>
      <div className="project-explorer-toolbar">
        <span>{t("files")}</span>
        <Button aria-label={t("createFile")} isDisabled={disabled} onPress={onCreate}>
          + {t("files")}
        </Button>
      </div>
      <SearchField
        aria-label={t("searchFiles")}
        className="project-explorer-search"
        value={search}
        onChange={setSearch}
      >
        <Input placeholder={t("searchFilenameOrPath")} />
      </SearchField>
      <div {...tree.getContainerProps(t("fileTreeLabel"))} className="project-explorer-tree">
        {tree.getItems().length === 0 && (
          <p className="project-explorer-empty" role="status">
            {t("noFilesMatch")}
          </p>
        )}
        {tree.getItems().map((item) => {
          const node = item.getItemData();
          const canSelect = node.file && node.selectable;
          const props = item.getProps();

          return (
            <div className="project-file-row" key={item.getId()}>
              <Button
                {...props}
                className={`project-file-open${node.file ? "" : " project-file-folder"}`}
                style={{ paddingInlineStart: `calc(0.5rem + ${item.getItemMeta().level}rem)` }}
                aria-current={canSelect && node.path === activePath ? "page" : undefined}
                isDisabled={disabled || (node.file && !node.selectable)}
              >
                <span className="project-file-indicator" aria-hidden="true">
                  {node.file ? "" : item.isExpanded() ? "▾" : "▸"}
                </span>
                <span className="project-file-name">{node.name}</span>
              </Button>
              {node.file && node.path !== "main.mcl" && (
                <span className="project-file-actions">
                  <Button
                    aria-label={t("renameFileFor", { path: node.path })}
                    isDisabled={disabled}
                    onPress={() => onRename(node.path)}
                  >
                    {t("renameFile")}
                  </Button>
                  <Button
                    aria-label={t("deleteFileFor", { path: node.path })}
                    isDisabled={disabled}
                    onPress={() => onDelete(node.path)}
                  >
                    {t("deleteFile")}
                  </Button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
