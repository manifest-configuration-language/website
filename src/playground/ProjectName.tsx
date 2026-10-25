import { useEffect, useRef, useState } from "react";
import "./ProjectName.css";

type Props = {
  name: string;
  disabled?: boolean;
  onSave: (name: string) => void;
};

export function ProjectName({ name, disabled = false, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => setValue(name), [name]);

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  function save() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const nextName = value.trim();
    if (nextName && nextName !== name) onSave(nextName);
    else setValue(name);
    setEditing(false);
  }

  if (editing)
    return (
      <input
        ref={input}
        className="playground-project-name-input"
        aria-label="プロジェクト名"
        value={value}
        maxLength={80}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            cancelled.current = true;
            setValue(name);
            setEditing(false);
          }
        }}
      />
    );

  return (
    <button
      type="button"
      className="playground-project-name"
      aria-label={`プロジェクト名: ${name}。クリックして変更`}
      disabled={disabled}
      onClick={() => {
        cancelled.current = false;
        setEditing(true);
      }}
    >
      {name}
    </button>
  );
}
