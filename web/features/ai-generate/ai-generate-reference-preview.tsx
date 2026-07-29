import { CreationAssistantReferencePreview } from "@/components/domain/creation-assistant-composer";
import type { AiGenerateReference } from "./ai-generate-runtime";

type AiGenerateReferencePreviewProps = {
  references: AiGenerateReference[];
  removable?: boolean;
  onRemove?: (referenceId: string) => void;
};

export function AiGenerateReferencePreview({
  references,
  removable = false,
  onRemove,
}: AiGenerateReferencePreviewProps) {
  return <CreationAssistantReferencePreview references={references} removable={removable} onRemove={onRemove} />;
}
