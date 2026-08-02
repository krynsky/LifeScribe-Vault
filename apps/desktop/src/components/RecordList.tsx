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
import type { ResolvedField, ResolvedSection } from "../domain/formModel";
import {
  findRecordReferenceUsages,
  type RecordReferenceContext,
} from "../domain/recordReferences";
import type { SectionValidationIssue } from "../domain/sectionValidation";
import type { SectionRecord, SectionValues } from "../domain/valuesStore";
import { FormRenderer } from "../forms/FormRenderer";
import { createRecordId, recordSummaryLabel } from "../forms/recordUtils";
import { ArchivedAnswers } from "./ArchivedAnswers";
import { RecordDeleteConfirmation } from "./RecordDeleteConfirmation";

export interface RecordListProps {
  section: ResolvedSection;
  values: SectionValues;
  /** Pack schemaVersion new records are stamped with. */
  schemaVersion: number;
  onChange: (values: SectionValues) => void;
  /** Forwarded to FormRenderer; called only when validation passes. */
  onSave?: (values: SectionValues) => void;
  /** Page-level required-field issues, rendered inline under each field. */
  validationIssues?: SectionValidationIssue[];
  recordReferences?: RecordReferenceContext;
}

export function RecordList({
  section,
  values,
  schemaVersion,
  onChange,
  onSave,
  validationIssues,
  recordReferences,
}: RecordListProps) {
  const allSections = recordReferences?.sections ?? [];
  const referenceValues = recordReferences?.savedValues ?? {};
  const referenceUsageValues = recordReferences?.effectiveValues ?? referenceValues;
  // `undefined` means the user has not yet touched the disclosure, so a record
  // carrying a validation issue may auto-expand; `null` is an explicit collapse.
  const [activeRecordId, setActiveRecordId] = useState<string | null | undefined>(undefined);
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
          externalIssues={validationIssues}
          recordReferences={recordReferences}
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
  const recordLabel = section.groups[0]?.title ?? section.title;
  const plainRecords = values.records.filter((record) => record.groupKey === undefined);

  // A record has an unresolved issue when a required field it owns is still
  // empty. Used to auto-expand the first offender and mark collapsed ones.
  const hasIssue = (record: SectionRecord): boolean =>
    (validationIssues ?? []).some(
      (issue) =>
        issue.recordId === record.id &&
        (record.values[issue.systemKey] ?? "").trim().length === 0,
    );
  const effectiveActiveId =
    activeRecordId === undefined
      ? (plainRecords.find(hasIssue)?.id ?? null)
      : activeRecordId;

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
              const label = recordSummaryLabel(
                record,
                orderedFields,
                section,
                allSections,
                referenceValues,
              );
              const expanded = effectiveActiveId === record.id;
              const usages =
                pendingDeleteId === record.id
                  ? findRecordReferenceUsages(
                      section.sectionKey,
                      record.id,
                      allSections,
                      referenceUsageValues,
                    )
                  : [];
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
                    {!expanded && hasIssue(record) ? (
                      <span className="record-list__row-error">Required info missing</span>
                    ) : null}
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
                    <RecordDeleteConfirmation
                      label={label}
                      usages={usages}
                      onConfirm={() => deleteRecord(record)}
                      onCancel={() => setPendingDeleteId(null)}
                    />
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
                        externalIssues={validationIssues}
                        recordReferences={recordReferences}
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
