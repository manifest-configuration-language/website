import type { EditorSettings } from "./MclEditor";
import { useTranslation } from "react-i18next";

type Props = {
  settings: EditorSettings;
  onChange: (settings: EditorSettings) => void;
};

export function PlaygroundSettingsDialog({ settings, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <details className="playground-more playground-settings">
      <summary>{t("settings")}</summary>
      <div className="playground-more-menu">
        <label className="playground-setting">
          {t("colorScheme")}
          <select
            value={settings.theme}
            onChange={(event) => {
              const theme = event.currentTarget.value as EditorSettings["theme"];
              onChange({ ...settings, theme });
            }}
          >
            <option value="system">{t("system")}</option>
            <option value="light">{t("light")}</option>
            <option value="dark">{t("dark")}</option>
          </select>
        </label>
        <label className="playground-setting">
          {t("indentationWidth")}
          <select
            value={settings.tabSize}
            onChange={(event) => {
              const tabSize = Number(event.currentTarget.value) as 2 | 4;
              onChange({ ...settings, tabSize });
            }}
          >
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="playground-setting">
          {t("fontSize")}
          <input
            type="range"
            min={12}
            max={20}
            step={2}
            value={settings.fontSize}
            aria-label={t("fontSize")}
            onChange={(event) => {
              const fontSize = Number(event.currentTarget.value) as EditorSettings["fontSize"];
              onChange({ ...settings, fontSize });
            }}
          />
          <output>{settings.fontSize}px</output>
        </label>
        <label className="playground-setting">
          <input
            type="checkbox"
            checked={settings.lineWrapping}
            onChange={(event) =>
              onChange({ ...settings, lineWrapping: event.currentTarget.checked })
            }
          />
          {t("lineWrapping")}
        </label>
        <label className="playground-setting">
          <input
            type="checkbox"
            checked={settings.lineNumbers}
            onChange={(event) =>
              onChange({ ...settings, lineNumbers: event.currentTarget.checked })
            }
          />
          {t("lineNumbers")}
        </label>
        <label className="playground-setting">
          <input
            type="checkbox"
            checked={settings.vim}
            onChange={(event) => onChange({ ...settings, vim: event.currentTarget.checked })}
          />
          {t("vim")}
        </label>
      </div>
    </details>
  );
}
