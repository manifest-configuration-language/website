import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import "./ProjectName.css";

type Props = {
  name: string;
  disabled?: boolean;
  onSave: (name: string) => void;
};

export function ProjectName({ name, disabled = false, onSave }: Props) {
  const { t } = useTranslation();
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
        aria-label={t("projectName")}
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
    <Button
      type="button"
      className="playground-project-name"
      aria-label={t("renameProjectHint", { name })}
      isDisabled={disabled}
      onClick={() => {
        cancelled.current = false;
        setEditing(true);
      }}
    >
      {name}
    </Button>
  );
}
