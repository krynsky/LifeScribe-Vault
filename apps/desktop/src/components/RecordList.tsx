/**
 * Section-level record UX (U4):
 *
 * - Multi-record sections render one collapsed summary row per record
 *   (labeled by the record's first readiness-rule protected-field value,
 *   then first non-empty value, then "Untitled"), an inline expanded edit
 *   form for the active record, a single "Add [record label]" button below
 *   the list, Duplicate per record, and Delete behind a confirm that names
 *   the record's summary label. The empty state shows the section lede plus
 *   the add affordance. Record ordering is stable.
 * - Singleton sections render one FormRenderer directly (the single record
 *   shape is auto-created on first input).
 * - Archived answers render as a collapsed disclosure below the active
 *   fields; deleting one updates the section values via onChange.
 */

import { useState } from "react";
import type { FieldDefinition, PackSection, ResolvedField, ResolvedSection } from "../domain/formModel";
import type { SectionRecord, SectionValues } from "../domain/valuesStore";
import { FormRenderer } from "../forms/FormRenderer";
import { createRecordId, recordSummaryLabel } from "../forms/recordUtils";
import { ArchivedAnswers } from "./ArchivedAnswers";

export interface RecordListProps {
  section: ResolvedSection;
  values: SectionValues;
  /** Pack schemaVersion new records are stamped with. */
  schemaVersion: number;
  onChange: (values: SectionValues) => void;
  /** Forwarded to FormRenderer; called only when validation passes. */
  onSave?: (values: SectionValues) => void;
  /** External errors keyed by systemKey, forwarded to the active form. */
  validationErrors?: Record<string, string>;
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

export function RecordList({
  section,
  values,
  schemaVersion,
  onChange,
  onSave,
  validationErrors,
  editing,
  packSection,
  onEditField,
  onRemoveField,
  onMoveField,
  onAddField,
  onEditGroupTitle,
}: RecordListProps) {
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDeleteArchived = (archivedAnswerId: string) =>
    onChange({
      ...values,
      archivedAnswers: values.archivedAnswers.filter(
        (answer) => answer.id !== archivedAnswerId,
      ),
    });

  const archived = (
    <ArchivedAnswers
      archivedAnswers={values.archivedAnswers}
      onDeleteArchived={handleDeleteArchived}
    />
  );

  if (!section.multiRecord) {
    return (
      <div className="record-list record-list--singleton">
        <FormRenderer
          section={section}
          values={values}
          schemaVersion={schemaVersion}
          onChange={onChange}
          onSave={onSave}
          validationErrors={validationErrors}
          editing={editing}
          packSection={packSection}
          onEditField={onEditField}
          onRemoveField={onRemoveField}
          onMoveField={onMoveField}
          onAddField={onAddField}
          onEditGroupTitle={onEditGroupTitle}
        />
        {archived}
      </div>
    );
  }

  // Note: domain's sectionFields() overloads resolve a ResolvedSection to the
  // PackSection overload (structural assignability), dropping ResolvedField
  // properties — collect fields inline instead.
  const orderedFields: ResolvedField[] = [...section.groups]
    .sort((left, right) => left.order - right.order)
    .flatMap((group) => [...group.fields].sort((left, right) => left.order - right.order))
    .filter((field) => !field.hidden);
  const readinessKeys = section.readinessRule.requiredKeys;
  const recordLabel = section.groups[0]?.title ?? section.title;
  const plainRecords = values.records.filter((record) => record.groupKey === undefined);

  const addRecord = () => {
    const record: SectionRecord = { id: createRecordId(), schemaVersion, values: {} };
    onChange({ ...values, records: [...values.records, record] });
    setActiveRecordId(record.id);
  };

  const duplicateRecord = (record: SectionRecord) => {
    const copy: SectionRecord = { ...record, id: createRecordId(), values: { ...record.values } };
    const index = values.records.findIndex((candidate) => candidate.id === record.id);
    const records = [...values.records];
    records.splice(index + 1, 0, copy);
    onChange({ ...values, records });
  };

  const deleteRecord = (record: SectionRecord) => {
    onChange({
      ...values,
      records: values.records.filter((candidate) => candidate.id !== record.id),
    });
    setPendingDeleteId(null);
    if (activeRecordId === record.id) {
      setActiveRecordId(null);
    }
  };

  return (
    <div className="record-list">
      {plainRecords.length === 0 ? (
        <div className="record-list__empty">
          <p className="record-list__lede">{section.lede}</p>
          <button type="button" className="record-list__add" onClick={addRecord}>
            Add {recordLabel}
          </button>
        </div>
      ) : (
        <>
          <ul className="record-list__items">
            {plainRecords.map((record) => {
              const label = recordSummaryLabel(record, orderedFields, readinessKeys);
              const expanded = activeRecordId === record.id;
              return (
                <li className="record-list__item" key={record.id}>
                  <div className="record-list__row">
                    <button
                      type="button"
                      className="record-list__summary"
                      aria-expanded={expanded}
                      onClick={() => setActiveRecordId(expanded ? null : record.id)}
                    >
                      {label}
                    </button>
                    <button
                      type="button"
                      className="record-list__action"
                      onClick={() => duplicateRecord(record)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="record-list__action record-list__action--danger"
                      onClick={() => setPendingDeleteId(record.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {pendingDeleteId === record.id ? (
                    <div className="record-list__confirm">
                      <p>Delete “{label}”? This cannot be undone.</p>
                      <button type="button" onClick={() => deleteRecord(record)}>
                        Confirm delete
                      </button>
                      <button type="button" onClick={() => setPendingDeleteId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {expanded ? (
                    <div className="record-list__editor">
                      <FormRenderer
                        section={section}
                        values={values}
                        schemaVersion={schemaVersion}
                        recordId={record.id}
                        onChange={onChange}
                        onSave={onSave}
                        validationErrors={validationErrors}
                        editing={editing}
                        packSection={packSection}
                        onEditField={onEditField}
                        onRemoveField={onRemoveField}
                        onMoveField={onMoveField}
                        onAddField={onAddField}
                        onEditGroupTitle={onEditGroupTitle}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button type="button" className="record-list__add" onClick={addRecord}>
            Add {recordLabel}
          </button>
        </>
      )}
      {archived}
    </div>
  );
}
