import { Command, defaultFilter } from "cmdk";

export type QuickAccessItem = {
  value: string;
  label: string;
  shortcut?: string;
  keywords?: string[];
  group?: string;
  description?: string;
  tags?: string[];
  difficulty?: string;
  preview?: string;
  onSelect: () => void;
};

type Props = {
  label: string;
  placeholder: string;
  emptyMessage: string;
  items: QuickAccessItem[];
};

export function QuickAccessList({ label, placeholder, emptyMessage, items }: Props) {
  const groups = new Map<string, QuickAccessItem[]>();
  for (const item of items) {
    const group = item.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return (
    <Command
      label={label}
      loop
      shouldFilter
      filter={(value, search, keywords) =>
        Math.max(
          defaultFilter(value, search),
          ...(keywords ?? []).map((word) => defaultFilter(word, search)),
        )
      }
    >
      <Command.Input autoFocus aria-label={label} placeholder={placeholder} />
      <Command.List>
        <Command.Empty>{emptyMessage}</Command.Empty>
        {[...groups.entries()].map(([group, groupedItems]) => (
          <Command.Group key={group || "default"} heading={group || undefined}>
            {groupedItems.map((item) => (
              <Command.Item
                key={item.value}
                value={item.value}
                keywords={[
                  ...(item.keywords ?? []),
                  ...(item.description ? [item.description] : []),
                  ...(item.tags ?? []),
                  ...(item.difficulty ? [item.difficulty] : []),
                  ...(item.preview ? [item.preview] : []),
                ]}
                onSelect={item.onSelect}
              >
                {item.description || item.preview || item.tags?.length || item.difficulty ? (
                  <div className="playground-quick-access-copy">
                    <div className="playground-quick-access-heading">
                      <span>{item.label}</span>
                      {item.difficulty && (
                        <span className="playground-quick-access-difficulty">
                          {item.difficulty}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <span className="playground-quick-access-description">
                        {item.description}
                      </span>
                    )}
                    {item.preview && (
                      <pre className="playground-quick-access-preview">{item.preview}</pre>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <span className="playground-quick-access-tags">{item.tags.join(" · ")}</span>
                    )}
                  </div>
                ) : (
                  <span>{item.label}</span>
                )}
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
