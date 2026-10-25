import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onFork: () => void;
  onReload: () => void;
};

export function DraftConflictDialog({ open, onFork, onReload }: Props) {
  const { t } = useTranslation();
  const [confirmingReload, setConfirmingReload] = useState(false);

  return (
    <ModalOverlay
      className="playground-aria-overlay"
      isOpen={open}
      isDismissable={false}
      isKeyboardDismissDisabled
    >
      <Modal className="playground-aria-modal">
        <Dialog
          aria-label={t(confirmingReload ? "draftDiscardTitle" : "draftConflictTitle")}
          className="playground-file-action"
        >
          <Heading slot="title">
            {t(confirmingReload ? "draftDiscardTitle" : "draftConflictTitle")}
          </Heading>
          <p>{t(confirmingReload ? "draftDiscardDescription" : "draftConflictDescription")}</p>
          <div className="playground-file-action-buttons">
            {confirmingReload ? (
              <>
                <Button onPress={() => setConfirmingReload(false)}>
                  {t("draftDiscardCancel")}
                </Button>
                <Button onPress={onReload}>{t("draftDiscardConfirm")}</Button>
              </>
            ) : (
              <>
                <Button onPress={onFork}>{t("draftConflictFork")}</Button>
                <Button
                  onPress={() => {
                    setConfirmingReload(true);
                  }}
                >
                  {t("draftConflictReload")}
                </Button>
              </>
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
