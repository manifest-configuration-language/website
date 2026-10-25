import type { EditorSettings } from "./MclEditor";

type Props = {
  settings: EditorSettings;
  onChange: (settings: EditorSettings) => void;
};

export function PlaygroundSettingsDialog({ settings, onChange }: Props) {
  return (
    <details className="playground-more playground-settings">
      <summary>設定</summary>
      <div className="playground-more-menu">
        <label className="playground-setting">
          配色
          <select
            value={settings.theme}
            onChange={(event) => {
              const theme = event.currentTarget.value as EditorSettings["theme"];
              onChange({ ...settings, theme });
            }}
          >
            <option value="system">システム</option>
            <option value="light">ライト</option>
            <option value="dark">ダーク</option>
          </select>
        </label>
        <label className="playground-setting">
          インデント幅
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
          文字サイズ
          <input
            type="range"
            min={12}
            max={20}
            step={2}
            value={settings.fontSize}
            aria-label="文字サイズ"
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
          折り返し
        </label>
        <label className="playground-setting">
          <input
            type="checkbox"
            checked={settings.lineNumbers}
            onChange={(event) =>
              onChange({ ...settings, lineNumbers: event.currentTarget.checked })
            }
          />
          行番号
        </label>
        <label className="playground-setting">
          <input
            type="checkbox"
            checked={settings.vim}
            onChange={(event) => onChange({ ...settings, vim: event.currentTarget.checked })}
          />
          Vim
        </label>
      </div>
    </details>
  );
}
