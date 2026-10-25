import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { SourceMapLocationCandidate } from "./PlaygroundResult";
import "./SourceMapCandidateDialog.css";

type Props = {
  candidates: SourceMapLocationCandidate[];
  onClose: () => void;
  onSelect: (candidate: SourceMapLocationCandidate) => void;
};

export function SourceMapCandidateDialog({ candidates, onClose, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <ModalOverlay
      className="playground-aria-overlay"
      isOpen={candidates.length > 1}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className="playground-aria-modal">
        <Dialog aria-label={t("sourceCandidates")} className="playground-source-map-candidates">
          <Heading slot="title">{t("sourceCandidates")}</Heading>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidateKey(candidate)}>
                <Button onPress={() => onSelect(candidate)}>
                  {candidate.path}:{candidate.range.start.line + 1}:
                  {candidate.range.start.character + 1}
                </Button>
              </li>
            ))}
          </ul>
          <Button onPress={onClose}>{t("cancel")}</Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function candidateKey(candidate: SourceMapLocationCandidate) {
  return [
    candidate.path,
    candidate.range.start.line,
    candidate.range.start.character,
    candidate.range.end.line,
    candidate.range.end.character,
  ].join(":");
}
