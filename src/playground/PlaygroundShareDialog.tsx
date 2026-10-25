import { useEffect, useRef } from "react";
import type { PlaygroundShareMode } from "./usePlaygroundSharing";

type Props = {
  open: boolean;
  sharing: boolean;
  onClose: () => void;
  onShare: (mode: PlaygroundShareMode) => void;
};

export function PlaygroundShareDialog({ open, sharing, onClose, onShare }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="playground-file-action"
      aria-labelledby="playground-share-title"
      onCancel={(event) => {
        if (sharing) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id="playground-share-title">共有</h2>
      <p>短縮URLは共有サーバーに保存します。URLを知る人は閲覧できます。</p>
      <div className="playground-file-action-buttons">
        <button type="button" disabled={sharing} onClick={() => onShare("short")}>
          短縮URLを作成
        </button>
        <button type="button" disabled={sharing} onClick={() => onShare("fragment")}>
          URLに埋め込む
        </button>
        <button type="button" disabled={sharing} onClick={onClose}>
          キャンセル
        </button>
      </div>
      <p>URL埋め込みはサーバーへ送信せず、プロジェクト全体をURLに含めます。</p>
      {sharing && <p role="status">共有中</p>}
    </dialog>
  );
}
