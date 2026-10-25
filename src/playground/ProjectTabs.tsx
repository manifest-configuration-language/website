import { useEffect, useMemo, useRef } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
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
  const nodes = useMemo(() => createFileTree(paths, files), [paths, files]);
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
      if (!previousFolders.current.has(folder)) tree.getItemInstance(folder).expand();
    }
    previousFolders.current = folders;
  }, [tree, nodes, expandedItems]);

  return (
    <nav className="project-explorer" aria-label="プロジェクトファイル">
      <div className="project-explorer-toolbar">
        <span>ファイル</span>
        <button type="button" aria-label="ファイルを作成" disabled={disabled} onClick={onCreate}>
          ＋ ファイル
        </button>
      </div>
      <div {...tree.getContainerProps("プロジェクトファイル")} className="project-explorer-tree">
        {tree.getItems().map((item) => {
          const node = item.getItemData();
          const canSelect = node.file && node.selectable;
          const props = item.getProps();

          return (
            <div className="project-file-row" key={item.getId()}>
              <button
                {...props}
                type="button"
                className={`project-file-open${node.file ? "" : " project-file-folder"}`}
                style={{ paddingInlineStart: `calc(0.5rem + ${item.getItemMeta().level}rem)` }}
                aria-current={canSelect && node.path === activePath ? "page" : undefined}
                aria-disabled={disabled || (node.file && !node.selectable) || undefined}
                title={node.path || undefined}
              >
                <span className="project-file-indicator" aria-hidden="true">
                  {node.file ? "" : item.isExpanded() ? "▾" : "▸"}
                </span>
                <span className="project-file-name">{node.name}</span>
              </button>
              {node.file && node.path !== "main.mcl" && (
                <span className="project-file-actions">
                  <button
                    type="button"
                    aria-label={`${node.path}の名前を変更`}
                    title="名前を変更"
                    disabled={disabled}
                    onClick={() => onRename(node.path)}
                  >
                    名前変更
                  </button>
                  <button
                    type="button"
                    aria-label={`${node.path}を削除`}
                    title="削除"
                    disabled={disabled}
                    onClick={() => onDelete(node.path)}
                  >
                    削除
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
