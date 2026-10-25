import { useMemo, useState } from "react";
import { Input, ListBox, ListBoxItem, SearchField } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { DraftMetadata } from "./usePlaygroundPersistence";
import "./ProjectDraftPicker.css";

type Props = {
  activeDraftId: string;
  drafts: DraftMetadata[];
  disabled: boolean;
  onOpenDraft: (id: string) => void;
};

export function ProjectDraftPicker({ activeDraftId, drafts, disabled, onOpenDraft }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visibleDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return drafts;
    return drafts.filter((draft) => draft.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [drafts, query]);

  return (
    <div className="playground-project-picker">
      <SearchField
        aria-label={t("searchProjects")}
        className="playground-project-search"
        value={query}
        onChange={setQuery}
      >
        <Input placeholder={t("searchProjectNames")} />
      </SearchField>
      <ListBox
        aria-label={t("openProject")}
        className="playground-project-list"
        items={visibleDrafts}
        selectionMode="single"
        selectedKeys={new Set([activeDraftId])}
        disabledKeys={disabled ? visibleDrafts.map((draft) => draft.id) : []}
        onSelectionChange={(key) => {
          if (key instanceof Set) {
            const selected = [...key][0];
            if (typeof selected === "string") onOpenDraft(selected);
          }
        }}
      >
        {(draft) => (
          <ListBoxItem id={draft.id} textValue={draft.name}>
            {draft.name === "作業" ? t("unnamedProject") : draft.name}
          </ListBoxItem>
        )}
      </ListBox>
      {visibleDrafts.length === 0 && (
        <p className="playground-project-search-empty" role="status">
          {t("noProjectsMatch")}
        </p>
      )}
    </div>
  );
}
