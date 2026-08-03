interface RecordDisclosureButtonProps {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}

export function RecordDisclosureButton({
  expanded,
  label,
  onToggle,
}: RecordDisclosureButtonProps) {
  const action = expanded ? "Collapse" : "Expand";

  return (
    <button
      type="button"
      className="button button--secondary button--small record-list__toggle"
      aria-expanded={expanded}
      aria-label={`${action} ${label}`}
      onClick={onToggle}
    >
      {action}
    </button>
  );
}
