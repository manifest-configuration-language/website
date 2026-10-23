import type { ProjectFile } from "./types";

type Props = {
  paths: string[];
  files: Record<string, ProjectFile>;
  activePath: string;
  onSelect: (path: string) => void;
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

export function ProjectTabs({ paths, files, activePath, onSelect, disabled = false }: Props) {
  const tree = createFileTree(paths);

  function renderNode(node: FileTreeNode) {
    if (node.file) {
      const selectable = node.path === "main.mcl" || node.path.endsWith(".mcl") && files[node.path]?.encoding === "utf8";
      return (
        <li key={node.path}>
          {selectable ? (
            <button
              type="button"
              aria-current={node.path === activePath ? "page" : undefined}
              title={node.path}
              disabled={disabled}
              onClick={() => onSelect(node.path)}
            >
              {node.name}
            </button>
          ) : <span title={node.path}>{node.name}</span>}
          {node.children.size > 0 && <ul>{[...node.children.values()].sort(compareNodes).map(renderNode)}</ul>}
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
    <nav aria-label="プロジェクトファイル" style={{ maxHeight: "8rem", overflow: "auto" }}>
      <ul style={{ listStyle: "none", margin: 0, paddingInlineStart: "0.75rem" }}>
        {[...tree.children.values()].sort(compareNodes).map(renderNode)}
      </ul>
    </nav>
  );
}
