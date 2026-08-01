import type { RecordReferenceUsage } from "../domain/recordReferences";

interface RecordDeleteConfirmationProps {
  label: string;
  usages: RecordReferenceUsage[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecordDeleteConfirmation({
  label,
  usages,
  onConfirm,
  onCancel,
}: RecordDeleteConfirmationProps) {
  const blocked = usages.length > 0;
  return (
    <div className="record-list__confirm">
      {blocked ? (
        <>
          <p>“{label}” cannot be deleted because it is used by:</p>
          <ul>
            {usages.map((usage) => (
              <li key={`${usage.sectionKey}:${usage.recordId}:${usage.fieldSystemKey}`}>
                {usage.sectionTitle}: {usage.recordLabel}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>Delete “{label}”? This cannot be undone.</p>
          <button type="button" onClick={onConfirm}>
            Confirm delete
          </button>
        </>
      )}
      <button type="button" onClick={onCancel}>
        {blocked ? "Close" : "Cancel"}
      </button>
    </div>
  );
}
