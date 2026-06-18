import { useState } from "react";
import { RecordList } from "../components/RecordList";
import { StatusBadge } from "../components/StatusBadge";
import type { FieldDefinition, PackSection, ResolvedSection } from "../domain/formModel";
import type { SectionStatus } from "../domain/readiness";
import type { SectionMeta } from "../domain/snapshot";
import type { SectionValidationIssue } from "../domain/sectionValidation";
import type { SectionValues } from "../domain/valuesStore";

export interface DraftBannerState {
  stashedAt: string | null;
  /** Stashed against an older snapshot generation than the one loaded. */
  stale: boolean;
}

export interface SectionPageProps {
  section: ResolvedSection;
  schemaVersion: number;
  /** Working values (saved values + any unsaved edits). */
  values: SectionValues;
  meta: SectionMeta;
  /** Status badge computed from SAVED data only. */
  status: SectionStatus;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  draftBanner: DraftBannerState | null;
  validationIssues: SectionValidationIssue[];
  onChange: (values: SectionValues) => void;
  onSave: () => void;
  onSaveAgain: () => void;
  onDiscardConflict: () => void;
  onDiscardDraft: () => void;
  onMarkReviewed: () => void;
  onSetNa: (na: boolean) => void;
  /** Whether form-structure editing is active for this section. */
  editing?: boolean;
  /** Raw PackSection needed to map resolved fields back to their editable definitions. */
  packSection?: PackSection;
  /** Called when a field's definition is changed inline. */
  onEditField?: (sectionKey: string, groupKey: string, updated: FieldDefinition) => void;
  /** Called when a field is removed. */
  onRemoveField?: (sectionKey: string, groupKey: string, systemKey: string) => void;
  /** Called when a field is moved up or down. */
  onMoveField?: (sectionKey: string, groupKey: string, systemKey: string, direction: "up" | "down") => void;
  /** Called when a new field should be added to a group. */
  onAddField?: (sectionKey: string, groupKey: string) => void;
  /** Called when a group's title changes. */
  onEditGroupTitle?: (sectionKey: string, groupKey: string, title: string) => void;
}

function formatStashTime(iso: string | null): string {
  if (!iso) {
    return "your last session";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "your last session";
  }
  return date.toLocaleString();
}

/**
 * One guided section: entry form, primary Save (generation-CAS), and the
 * secondary "Mark as reviewed" / "Doesn't apply to me" actions below it.
 */
export function SectionPage({
  section,
  schemaVersion,
  values,
  meta,
  status,
  dirty,
  saving,
  conflict,
  draftBanner,
  validationIssues,
  onChange,
  onSave,
  onSaveAgain,
  onDiscardConflict,
  onDiscardDraft,
  onMarkReviewed,
  onSetNa,
  editing,
  packSection,
  onEditField,
  onRemoveField,
  onMoveField,
  onAddField,
  onEditGroupTitle,
}: SectionPageProps) {
  const [confirmingNa, setConfirmingNa] = useState(false);

  return (
    <article className="section-page" aria-labelledby="section-title">
      <header className="section-page__header">
        <div className="section-page__heading">
          <h1 className="section-page__title" id="section-title">
            {section.title}
          </h1>
          <StatusBadge status={status} />
        </div>
        <p className="section-page__lede">{section.lede}</p>
      </header>

      {conflict ? (
        <div className="banner banner--warning" role="alert">
          <p className="banner__text">
            The vault was updated since you opened this section — maybe by a
            restore or another save. Your edits are still here. Save again to
            apply them on top of the latest data, or discard to reload it.
          </p>
          <div className="banner__actions">
            <button className="button button--primary button--small" type="button" onClick={onSaveAgain}>
              Save again
            </button>
            <button className="button button--ghost button--small" type="button" onClick={onDiscardConflict}>
              Discard my edits
            </button>
          </div>
        </div>
      ) : null}

      {draftBanner ? (
        <div
          className={
            draftBanner.stale ? "banner banner--warning" : "banner banner--info"
          }
          role="status"
        >
          <p className="banner__text">
            {draftBanner.stale
              ? `Unsaved changes from ${formatStashTime(draftBanner.stashedAt)} were restored, but the vault changed since this draft was set aside — review carefully before saving.`
              : `Unsaved changes from ${formatStashTime(draftBanner.stashedAt)} were restored.`}
          </p>
          <div className="banner__actions">
            <button className="button button--ghost button--small" type="button" onClick={onDiscardDraft}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {meta.na ? (
        <div className="banner banner--neutral" role="status">
          <p className="banner__text">
            You've marked this section as not applying to you — it counts as
            complete on your checklist.
          </p>
          <div className="banner__actions">
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => onSetNa(false)}
            >
              It applies to me after all
            </button>
          </div>
        </div>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="banner banner--error" role="alert">
          <p className="banner__text">A few required details are missing:</p>
          <ul className="banner__list">
            {validationIssues.map((issue) => (
              <li key={`${issue.recordId ?? "section"}:${issue.systemKey}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="section-page__form">
        <RecordList
          section={section}
          values={values}
          schemaVersion={schemaVersion}
          onChange={onChange}
          editing={editing}
          packSection={packSection}
          onEditField={onEditField}
          onRemoveField={onRemoveField}
          onMoveField={onMoveField}
          onAddField={onAddField}
          onEditGroupTitle={onEditGroupTitle}
        />
      </div>

      <footer className="section-page__actions">
        <button
          className="button button--primary"
          disabled={saving}
          type="button"
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty ? <span className="section-page__dirty-hint">Unsaved changes</span> : null}

        <div className="section-page__secondary">
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={onMarkReviewed}
          >
            Mark as reviewed
          </button>
          {!meta.na ? (
            confirmingNa ? (
              <span className="section-page__na-confirm">
                <span>This section will count as complete.</span>
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => {
                    setConfirmingNa(false);
                    onSetNa(true);
                  }}
                >
                  Confirm
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => setConfirmingNa(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => setConfirmingNa(true)}
              >
                Doesn't apply to me
              </button>
            )
          ) : null}
        </div>
      </footer>
    </article>
  );
}
