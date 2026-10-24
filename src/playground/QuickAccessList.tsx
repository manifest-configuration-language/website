import { Command, defaultFilter } from "cmdk";

export type QuickAccessItem = {
  value: string;
  label: string;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
};

type Props = {
  label: string;
  placeholder: string;
  emptyMessage: string;
  items: QuickAccessItem[];
};

export function QuickAccessList({ label, placeholder, emptyMessage, items }: Props) {
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
        {items.map((item) => (
          <Command.Item
            key={item.value}
            value={item.value}
            keywords={item.keywords}
            onSelect={item.onSelect}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
