import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  sharing: boolean;
  onClose: () => void;
  onShare: () => void;
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
      <p>リンクを知っている人は閲覧できます</p>
      <div className="playground-file-action-buttons">
        <button type="button" disabled={sharing} onClick={onShare}>
          共有リンクをコピー
        </button>
        <button type="button" disabled={sharing} onClick={onClose}>
          キャンセル
        </button>
      </div>
      {sharing && <p role="status">共有中</p>}
    </dialog>
  );
}
