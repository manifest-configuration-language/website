import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

type QuickAccessModalProps = {
  isOpen: boolean;
  onClose: () => void;
  label: string;
  className: string;
  children: ReactNode;
};

function QuickAccessModal({ isOpen, onClose, label, className, children }: QuickAccessModalProps) {
  return (
    <ModalOverlay
      className="playground-modal-overlay"
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal>
        <Dialog className={className} aria-label={label}>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
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
  const { t } = useTranslation();

  return (
    <>
      <QuickAccessModal
        isOpen={examplesOpen}
        onClose={onCloseExamples}
        label={t("examplesTitle")}
        className="playground-examples-dialog"
      >
        <header className="playground-dialog-header">
          <Heading slot="title">{t("examplesTitle")}</Heading>
          <Button type="button" onPress={onCloseExamples} aria-label={t("close")}>
            ×
          </Button>
        </header>
        <QuickAccessList
          label={t("searchExamples")}
          placeholder={t("searchNameOrCategory")}
          emptyMessage={t("noExamplesFound")}
          items={exampleItems}
        />
      </QuickAccessModal>
      <QuickAccessModal
        isOpen={quickOpen}
        onClose={onCloseQuickOpen}
        label={t("openFile")}
        className="playground-quick-open"
      >
        <QuickAccessList
          label={t("goToFile")}
          placeholder={t("enterFilename")}
          emptyMessage={t("noFilesFound")}
          items={quickOpenItems}
        />
      </QuickAccessModal>
      <QuickAccessModal
        isOpen={commandPaletteOpen}
        onClose={onCloseCommandPalette}
        label={t("commandPalette")}
        className="playground-quick-open"
      >
        <QuickAccessList
          label={t("commandPalette")}
          placeholder={t("searchCommand")}
          emptyMessage={t("noCommandsFound")}
          items={commandItems}
        />
      </QuickAccessModal>
    </>
  );
}
