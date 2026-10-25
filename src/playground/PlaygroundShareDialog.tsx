import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  sharing: boolean;
  shareURL: string;
  shareError: string;
  onClose: () => void;
  onShare: () => void;
};

export function PlaygroundShareDialog({
  open,
  sharing,
  shareURL,
  shareError,
  onClose,
  onShare,
}: Props) {
  const { t } = useTranslation();

  return (
    <ModalOverlay
      className="playground-aria-overlay"
      isOpen={open}
      isDismissable={!sharing}
      onOpenChange={(isOpen) => {
        if (!isOpen && !sharing) onClose();
      }}
    >
      <Modal className="playground-aria-modal">
        <Dialog aria-label={t("share")} className="playground-file-action">
          <Heading slot="title">{t("share")}</Heading>
          <p>{t("shareAccessNotice")}</p>
          {shareError && <p role="alert">{shareError}</p>}
          {shareURL && (
            <label className="playground-share-url-field">
              <span>{t("shareLinkLabel")}</span>
              <Input
                aria-label={t("shareLinkLabel")}
                value={shareURL}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
          <div className="playground-file-action-buttons">
            <Button isDisabled={sharing} onPress={onShare}>
              {t("copyShareLink")}
            </Button>
          </div>
          {sharing && <p role="status">{t("sharing")}</p>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
