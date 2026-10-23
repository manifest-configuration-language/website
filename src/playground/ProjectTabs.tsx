type Props = {
  paths: string[];
  activePath: string;
  onSelect: (path: string) => void;
  disabled?: boolean;
};

function labelForPath(path: string): string {
  const fileName = path.split("/").filter(Boolean).at(-1) ?? path;
  return fileName.endsWith(".mcl") ? fileName.slice(0, -4) : fileName;
}

export function ProjectTabs({ paths, activePath, onSelect, disabled = false }: Props) {
  return (
    <div className="playground-file-tabs" role="tablist" aria-label="MCL project files">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          role="tab"
          aria-selected={path === activePath}
          aria-label={path}
          title={path}
          disabled={disabled}
          onClick={() => onSelect(path)}
        >
          {labelForPath(path)}
        </button>
      ))}
    </div>
  );
}
