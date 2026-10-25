import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onDelete: () => void;
};

export function DeleteProjectDialog({ open, projectName, onClose, onDelete }: Props) {
  const { t } = useTranslation();

  return (
    <ModalOverlay
      className="playground-aria-overlay"
      isOpen={open}
      isDismissable
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Modal className="playground-aria-modal">
        <Dialog aria-label={t("deleteProjectTitle")} className="playground-file-action">
          <Heading slot="title">{t("deleteProjectTitle")}</Heading>
          <p>{t("deleteProjectDescription", { name: projectName })}</p>
          <div className="playground-file-action-buttons">
            <Button onPress={onClose}>{t("cancel")}</Button>
            <Button className="playground-file-action-danger" onPress={onDelete}>
              {t("deleteProject")}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
