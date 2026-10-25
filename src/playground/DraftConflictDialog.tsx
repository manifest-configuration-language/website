import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onFork: () => void;
  onReload: () => void;
};

export function DraftConflictDialog({ open, onFork, onReload }: Props) {
  const { t } = useTranslation();

  return (
    <ModalOverlay
      className="playground-aria-overlay"
      isOpen={open}
      isDismissable={false}
      isKeyboardDismissDisabled
    >
      <Modal className="playground-aria-modal">
        <Dialog aria-label={t("draftConflictTitle")} className="playground-file-action">
          <Heading slot="title">{t("draftConflictTitle")}</Heading>
          <p>{t("draftConflictDescription")}</p>
          <div className="playground-file-action-buttons">
            <Button onPress={onFork}>{t("draftConflictFork")}</Button>
            <Button onPress={onReload}>{t("draftConflictReload")}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
