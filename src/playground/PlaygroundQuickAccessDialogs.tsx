import { useEffect, useRef } from "react";
import { QuickAccessList, type QuickAccessItem } from "./QuickAccessList";

type Props = {
  examplesOpen: boolean;
  onCloseExamples: () => void;
  exampleItems: QuickAccessItem[];
  quickOpen: boolean;
  onCloseQuickOpen: () => void;
  quickOpenItems: QuickAccessItem[];
  commandPaletteOpen: boolean;
  onCloseCommandPalette: () => void;
  commandItems: QuickAccessItem[];
};

function useModalDialog(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return dialog;
}

export function PlaygroundQuickAccessDialogs({
  examplesOpen,
  onCloseExamples,
  exampleItems,
  quickOpen,
  onCloseQuickOpen,
  quickOpenItems,
  commandPaletteOpen,
  onCloseCommandPalette,
  commandItems,
}: Props) {
  const examplesDialog = useModalDialog(examplesOpen);
  const quickOpenDialog = useModalDialog(quickOpen);
  const commandPaletteDialog = useModalDialog(commandPaletteOpen);

  return (
    <>
      <dialog
        ref={examplesDialog}
        className="playground-examples-dialog"
        aria-labelledby="playground-examples-title"
        onCancel={onCloseExamples}
      >
        <header className="playground-dialog-header">
          <h2 id="playground-examples-title">サンプル</h2>
          <button type="button" onClick={onCloseExamples} aria-label="閉じる">
            ×
          </button>
        </header>
        <QuickAccessList
          label="サンプルを検索"
          placeholder="名前やカテゴリで検索"
          emptyMessage="一致するサンプルはありません"
          items={exampleItems}
        />
      </dialog>
      {quickOpen && (
        <dialog
          ref={quickOpenDialog}
          className="playground-quick-open"
          aria-label="ファイルを開く"
          onCancel={onCloseQuickOpen}
        >
          <QuickAccessList
            label="ファイルへ移動"
            placeholder="ファイル名を入力"
            emptyMessage="一致するファイルはありません"
            items={quickOpenItems}
          />
        </dialog>
      )}
      {commandPaletteOpen && (
        <dialog
          ref={commandPaletteDialog}
          className="playground-quick-open"
          aria-label="コマンド"
          onCancel={onCloseCommandPalette}
        >
          <QuickAccessList
            label="コマンド"
            placeholder="コマンドを検索"
            emptyMessage="一致するコマンドはありません"
            items={commandItems}
          />
        </dialog>
      )}
    </>
  );
}
