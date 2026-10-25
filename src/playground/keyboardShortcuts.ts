export const shortcutActionIDs = [
  "commandPalette",
  "quickOpen",
  "toggleExplorer",
  "showProblems",
] as const;

export type ShortcutActionID = (typeof shortcutActionIDs)[number];
export type PlaygroundShortcuts = Record<ShortcutActionID, string>;

export const defaultPlaygroundShortcuts: PlaygroundShortcuts = {
  commandPalette: "Mod+Shift+KeyP",
  quickOpen: "Mod+KeyP",
  toggleExplorer: "Mod+Shift+KeyE",
  showProblems: "Mod+Shift+KeyM",
};

const codePattern =
  /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Enter|Escape|Space|Tab|Backspace|Delete|Slash|Comma|Period|BracketLeft|BracketRight|Minus|Equal|Semicolon|Quote|Backquote|Backslash)$/;
const reservedShortcuts = new Set([
  "Mod+KeyL",
  "Mod+KeyN",
  "Mod+KeyQ",
  "Mod+KeyR",
  "Mod+KeyT",
  "Mod+KeyW",
  "Mod+Alt+KeyI",
  "Mod+Alt+KeyJ",
  "Mod+Alt+KeyC",
  "Alt+F4",
  "F5",
  "F11",
]);

function canonicalParts(value: string): string[] | undefined {
  const input = value.split("+");
  if (input.length < 2 || input.some((part) => !part)) return undefined;
  const key = input.at(-1);
  if (!key || !codePattern.test(key)) return undefined;
  const modifiers = input.slice(0, -1);
  if (
    modifiers.some((modifier) => !["Mod", "Alt", "Shift"].includes(modifier)) ||
    new Set(modifiers).size !== modifiers.length ||
    (!modifiers.includes("Mod") && !modifiers.includes("Alt") && !/^F(?:[1-9]|1[0-2])$/.test(key))
  )
    return undefined;
  return [
    ...(modifiers.includes("Mod") ? ["Mod"] : []),
    ...(modifiers.includes("Alt") ? ["Alt"] : []),
    ...(modifiers.includes("Shift") ? ["Shift"] : []),
    key,
  ];
}

export function normalizeShortcut(value: string): string | undefined {
  return canonicalParts(value)?.join("+");
}

export function isReservedShortcut(value: string): boolean {
  const normalized = normalizeShortcut(value);
  if (!normalized) return true;
  return reservedShortcuts.has(normalized);
}

export function isPlaygroundShortcuts(value: unknown): value is PlaygroundShortcuts {
  if (!value || typeof value !== "object") return false;
  const shortcuts = value as Record<string, unknown>;
  if (!shortcutActionIDs.every((id) => typeof shortcuts[id] === "string")) return false;
  const normalized = shortcutActionIDs.map((id) => normalizeShortcut(shortcuts[id] as string));
  return (
    normalized.every((shortcut) => shortcut !== undefined && !isReservedShortcut(shortcut)) &&
    new Set(normalized).size === shortcutActionIDs.length
  );
}

export function captureShortcut(event: KeyboardEvent): string | undefined {
  if (event.repeat || !event.code || event.key === "Dead" || event.key === "Unidentified")
    return undefined;
  const modifiers = [
    ...(event.metaKey || event.ctrlKey ? ["Mod"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
  ];
  const shortcut = normalizeShortcut([...modifiers, event.code].join("+"));
  return shortcut && !isReservedShortcut(shortcut) ? shortcut : undefined;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = canonicalParts(shortcut);
  if (!parts) return false;
  const key = parts.at(-1);
  const hasMod = parts.includes("Mod");
  const hasAlt = parts.includes("Alt");
  const hasShift = parts.includes("Shift");
  return (
    event.code === key &&
    (event.metaKey || event.ctrlKey) === hasMod &&
    event.altKey === hasAlt &&
    event.shiftKey === hasShift
  );
}

function displayKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return (
    {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Enter: "Enter",
      Escape: "Esc",
      Space: "Space",
      Slash: "/",
      Comma: ",",
      Period: ".",
      BracketLeft: "[",
      BracketRight: "]",
      Minus: "-",
      Equal: "=",
      Semicolon: ";",
      Quote: "'",
      Backquote: "`",
      Backslash: "\\",
    }[code] ?? code
  );
}

export function formatShortcut(value: string): string {
  const parts = canonicalParts(value);
  if (!parts) return value;
  const key = parts.at(-1) ?? "";
  return [
    ...(parts.includes("Mod") ? ["Ctrl/⌘"] : []),
    ...(parts.includes("Alt") ? ["Alt"] : []),
    ...(parts.includes("Shift") ? ["⇧"] : []),
    displayKey(key),
  ].join(" ");
}

export function formatAriaShortcut(value: string): string {
  const parts = canonicalParts(value);
  if (!parts) return "";
  const code = parts.at(-1) ?? "";
  const key = code.startsWith("Key")
    ? code.slice(3).toLowerCase()
    : code.startsWith("Digit")
      ? code.slice(5)
      : code.startsWith("Arrow")
        ? code
        : ({ Escape: "Escape", Slash: "/", Comma: ",", Period: "." }[code] ?? code);
  const modifiers = [
    ...(parts.includes("Alt") ? ["Alt"] : []),
    ...(parts.includes("Shift") ? ["Shift"] : []),
  ];
  const suffix = [...modifiers, key].join("+");
  return parts.includes("Mod") ? `Control+${suffix} Meta+${suffix}` : suffix;
}
