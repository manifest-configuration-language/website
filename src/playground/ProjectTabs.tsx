import type { ProjectFile } from "./types";

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
  children: Map<string, FileTreeNode>;
};

function createFileTree(paths: string[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", file: false, children: new Map() };
  for (const path of paths) {
    let parent = root;
    const parts = path.split("/");
    let nodePath = "";
    for (const [index, name] of parts.entries()) {
      nodePath = nodePath ? `${nodePath}/${name}` : name;
      let node = parent.children.get(name);
      if (!node) {
        node = { name, path: nodePath, file: index === parts.length - 1, children: new Map() };
        parent.children.set(name, node);
      } else if (index === parts.length - 1) {
        node.file = true;
      }
      parent = node;
    }
  }
  return root;
}

function compareNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.file !== right.file) return left.file ? 1 : -1;
  return left.name.localeCompare(right.name);
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
  const tree = createFileTree(paths);

  function renderNode(node: FileTreeNode) {
    if (node.file) {
      const selectable = node.path === "main.mcl" || files[node.path]?.encoding === "utf8";
      return (
        <li className="project-file-row" key={node.path}>
          {selectable ? (
            <button
              type="button"
              className="project-file-open"
              aria-current={node.path === activePath ? "page" : undefined}
              title={node.path}
              disabled={disabled}
              onClick={() => onSelect(node.path)}
            >
              {node.name}
            </button>
          ) : (
            <span title={node.path}>{node.name}</span>
          )}
          {node.path !== "main.mcl" && (
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
          {node.children.size > 0 && (
            <ul>{[...node.children.values()].sort(compareNodes).map(renderNode)}</ul>
          )}
        </li>
      );
    }
    return (
      <li key={node.path}>
        <details open>
          <summary>{node.name}</summary>
          <ul>{[...node.children.values()].sort(compareNodes).map(renderNode)}</ul>
        </details>
      </li>
    );
  }

  return (
    <nav className="project-explorer" aria-label="プロジェクトファイル">
      <div className="project-explorer-toolbar">
        <span>ファイル</span>
        <button type="button" aria-label="ファイルを作成" disabled={disabled} onClick={onCreate}>
          ＋ ファイル
        </button>
      </div>
      <ul>{[...tree.children.values()].sort(compareNodes).map(renderNode)}</ul>
    </nav>
  );
}
