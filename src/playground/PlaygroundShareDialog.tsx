import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  sharing: boolean;
  onClose: () => void;
  onShare: () => void;
};

export function PlaygroundShareDialog({ open, sharing, onClose, onShare }: Props) {
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
