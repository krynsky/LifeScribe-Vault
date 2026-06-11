import { useState } from "react";
import type { ArchivedAnswer } from "../domain/valuesStore";

export interface ArchivedAnswersProps {
  archivedAnswers: ArchivedAnswer[];
  /** Permanently delete one archived answer (already confirmed by the user). */
  onDeleteArchived: (archivedAnswerId: string) => void;
}

/**
 * Collapsed "Archived data" disclosure rendered below a section's active
 * fields. Each archived answer shows its original label, read-only value,
 * and the reason it was archived. The sole action is permanent delete,
 * behind an inline confirm.
 */
export function ArchivedAnswers({ archivedAnswers, onDeleteArchived }: ArchivedAnswersProps) {
  const [open, setOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (archivedAnswers.length === 0) {
    return null;
  }

  return (
    <section className="archived-answers">
      <button
        type="button"
        className="archived-answers__toggle"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        Archived data ({archivedAnswers.length})
      </button>
      {open ? (
        <ul className="archived-answers__list">
          {archivedAnswers.map((answer) => (
            <li className="archived-answers__item" key={answer.id}>
              <p className="archived-answers__label">{answer.originalLabel || answer.systemKey}</p>
              <p className="archived-answers__value">{answer.value}</p>
              <p className="archived-answers__reason">{answer.reason}</p>
              {pendingDeleteId === answer.id ? (
                <div className="archived-answers__confirm">
                  <p>
                    Permanently delete the archived answer for “
                    {answer.originalLabel || answer.systemKey}”? This cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteArchived(answer.id);
                      setPendingDeleteId(null);
                    }}
                  >
                    Confirm delete
                  </button>
                  <button type="button" onClick={() => setPendingDeleteId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="archived-answers__delete"
                  onClick={() => setPendingDeleteId(answer.id)}
                >
                  Delete permanently
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
