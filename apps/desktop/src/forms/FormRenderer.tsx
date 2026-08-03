/**
 * Generic schema renderer (U4): turns one resolved section definition plus
 * its stored values into a controlled entry form — grouped layout,
 * repeatable-group record CRUD, declarative conditional visibility, and
 * required-field validation — with zero per-section components.
 *
 * Laws honored here:
 * - All pack-sourced strings (labels, helper text, options, titles) render
 *   as text nodes only; nothing is ever interpreted as HTML.
 * - Hidden-but-populated conditional values are retained in the record,
 *   excluded from required-validation while hidden, and reappear when the
 *   condition re-truthifies. Required + condition-hidden validates as
 *   not-required.
 * - Overlay-hidden fields (`field.hidden`) never render and never validate.
 * - Saved select values flagged as "previous answers" render read-only
 *   inline at their field with a marker; they are never silently cleared.
 */

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { Field } from "../components/Field";
import { RecordDeleteConfirmation } from "../components/RecordDeleteConfirmation";
import {
  isConditionSatisfied,
  type ResolvedField,
  type ResolvedGroup,
  type ResolvedSection,
} from "../domain/formModel";
import {
  findRecordReferenceUsages,
  resolveRecordReference,
  type RecordReferenceContext,
  type ResolvedRecordReference,
} from "../domain/recordReferences";
import type { SectionValidationIssue } from "../domain/sectionValidation";
import {
  type AttachmentRef,
  type SectionRecord,
  type SectionValues,
  upsertSectionRecord,
} from "../domain/valuesStore";
import { FileField } from "./FileField";
import { PathField } from "./PathField";
import { createRecordId, recordSummaryLabel } from "./recordUtils";

export interface FormRendererProps {
  section: ResolvedSection;
  values: SectionValues;
  /** Pack schemaVersion new records are stamped with. */
  schemaVersion: number;
  /**
   * Which plain record this form edits. When absent, the first plain record
   * (no groupKey) is bound, auto-creating its shape for singleton sections.
   */
  recordId?: string;
  onChange: (values: SectionValues) => void;
  /** When provided, a Save button renders; called only when validation passes. */
  onSave?: (values: SectionValues) => void;
  /**
   * Required-field issues from the page-level Save, shown inline under the
   * matching field. Each issue is "required and empty", so it is displayed only
   * while the field is still empty and clears itself as soon as a value is
   * entered — no separate dismissal is needed.
   */
  externalIssues?: SectionValidationIssue[];
  recordReferences?: RecordReferenceContext;
}

type FieldControlElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const EMPTY_RECORD_REFERENCE_CONTEXT: RecordReferenceContext = {
  sections: [],
  savedValues: {},
  effectiveValues: {},
};

interface FieldControlProps {
  field: ResolvedField;
  fieldId: string;
  value: string;
  describedBy?: string;
  onValueChange: (value: string) => void;
  recordReference?: ResolvedRecordReference;
  recordReferenceSourceTitle?: string;
}

function FieldControl({
  field,
  fieldId,
  value,
  describedBy,
  onValueChange,
  recordReference,
  recordReferenceSourceTitle,
}: FieldControlProps) {
  const handleChange = (event: ChangeEvent<FieldControlElement>) =>
    onValueChange(event.currentTarget.value);

  if (field.type === "textarea") {
    return (
      <textarea
        className="field__control"
        id={fieldId}
        rows={4}
        value={value}
        aria-describedby={describedBy}
        onChange={handleChange}
      />
    );
  }

  if (field.type === "select") {
    const options = field.options ?? [];
    const valueIsListed = options.some((option) => option.value === value);
    return (
      <select
        className="field__control"
        id={fieldId}
        value={valueIsListed ? value : ""}
        aria-describedby={describedBy}
        onChange={handleChange}
      >
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "recordRef") {
    const options = recordReference?.options ?? [];
    const unavailableValue = recordReference?.unavailableValue;
    const hasChoices = options.length > 0 || unavailableValue !== null;
    return (
      <select
        className="field__control"
        id={fieldId}
        value={value}
        disabled={!hasChoices}
        aria-describedby={describedBy}
        onChange={handleChange}
      >
        <option value="">
          {options.length > 0
            ? "Select a saved record"
            : `No saved ${recordReferenceSourceTitle ?? "source"} records available`}
        </option>
        {unavailableValue ? (
          <option value={unavailableValue}>Unavailable saved record</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType =
    field.type === "phone" ? "tel" : field.type === "text" ? "text" : field.type;
  return (
    <input
      className="field__control"
      id={fieldId}
      type={inputType}
      value={value}
      aria-describedby={describedBy}
      onChange={handleChange}
    />
  );
}

function errorKey(recordId: string, systemKey: string): string {
  return `${recordId}:${systemKey}`;
}

export function FormRenderer({
  section,
  values,
  schemaVersion,
  recordId,
  onChange,
  onSave,
  externalIssues,
  recordReferences,
}: FormRendererProps) {
  const referenceContext = recordReferences ?? EMPTY_RECORD_REFERENCE_CONTEXT;
  const allSections = referenceContext.sections;
  const referenceValues = referenceContext.savedValues;
  const referenceUsageValues = referenceContext.effectiveValues;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expandedByGroup, setExpandedByGroup] = useState<Record<string, string | null>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const recordReferenceCatalog = useMemo(() => {
    const catalog = new Map<
      string,
      { options: ResolvedRecordReference["options"]; optionValues: Set<string>; sourceTitle?: string }
    >();
    for (const field of section.groups.flatMap((group) => group.fields)) {
      if (field.type !== "recordRef") continue;
      const resolved = resolveRecordReference(field, allSections, referenceValues);
      catalog.set(field.systemKey, {
        options: resolved.options,
        optionValues: new Set(resolved.options.map((option) => option.value)),
        sourceTitle: allSections.find(
          (candidate) => candidate.sectionKey === field.reference?.sectionKey,
        )?.title,
      });
    }
    return catalog;
  }, [allSections, referenceValues, section.groups]);

  // Stable id for the auto-created record shape of a section that has no
  // plain record yet — the record itself enters the store on first change.
  const [draftRecordId] = useState(createRecordId);

  const boundRecord: SectionRecord = (recordId
    ? values.records.find((record) => record.id === recordId)
    : values.records.find((record) => record.groupKey === undefined)) ?? {
    id: recordId ?? draftRecordId,
    schemaVersion,
    values: {},
  };

  const sortedGroups = [...section.groups].sort((left, right) => left.order - right.order);

  const updateRecordValue = (record: SectionRecord, systemKey: string, value: string) => {
    setErrors((previous) => {
      const key = errorKey(record.id, systemKey);
      if (!(key in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[key];
      return next;
    });
    onChange(
      upsertSectionRecord(values, {
        ...record,
        values: { ...record.values, [systemKey]: value },
      }),
    );
  };

  const groupRecords = (group: ResolvedGroup): SectionRecord[] =>
    values.records.filter((record) => record.groupKey === group.groupKey);

  /**
   * The page-level required-field message for this record/field, or undefined.
   * A section issue with `recordId: null` (singleton with no record yet) binds
   * to the auto-created bound record. Suppressed once the field has a value, so
   * the error clears itself as the user types.
   */
  const externalErrorFor = (record: SectionRecord, systemKey: string): string | undefined => {
    if (!externalIssues) return undefined;
    if ((record.values[systemKey] ?? "").trim().length > 0) return undefined;
    const issue = externalIssues.find(
      (candidate) =>
        candidate.systemKey === systemKey &&
        (candidate.recordId === record.id ||
          (candidate.recordId === null && record.id === boundRecord.id)),
    );
    return issue?.message;
  };

  /** Records of a repeatable group that currently carry an unresolved issue. */
  const erroredGroupRecordIds = (group: ResolvedGroup): Set<string> =>
    new Set(
      groupRecords(group)
        .filter((record) => group.fields.some((f) => externalErrorFor(record, f.systemKey)))
        .map((record) => record.id),
    );

  const addGroupRecord = (group: ResolvedGroup) => {
    const record: SectionRecord = {
      id: createRecordId(),
      groupKey: group.groupKey,
      schemaVersion,
      values: {},
    };
    onChange({ ...values, records: [...values.records, record] });
    setExpandedByGroup((previous) => ({ ...previous, [group.groupKey]: record.id }));
  };

  const duplicateGroupRecord = (record: SectionRecord) => {
    const copy: SectionRecord = {
      ...record,
      id: createRecordId(),
      values: { ...record.values },
    };
    const index = values.records.findIndex((candidate) => candidate.id === record.id);
    const records = [...values.records];
    records.splice(index + 1, 0, copy);
    onChange({ ...values, records });
  };

  const deleteGroupRecord = (record: SectionRecord) => {
    onChange({
      ...values,
      records: values.records.filter((candidate) => candidate.id !== record.id),
    });
    setPendingDeleteId(null);
  };

  const referenceUsages = (record: SectionRecord) =>
    findRecordReferenceUsages(
      section.sectionKey,
      record.id,
      allSections,
      referenceUsageValues,
    );

  const fieldDomId = (record: SectionRecord, systemKey: string): string =>
    `${section.sectionKey}--${record.id}--${systemKey}`;

  const attachFileToRecord = (record: SectionRecord, systemKey: string, ref: AttachmentRef) => {
    const previousId = record.values[systemKey];
    const withoutOld = (record.attachments ?? []).filter((a) => a.id !== previousId);
    onChange(
      upsertSectionRecord(values, {
        ...record,
        values: { ...record.values, [systemKey]: ref.id },
        attachments: [...withoutOld, ref],
      }),
    );
  };

  const removeFileFromRecord = (record: SectionRecord, systemKey: string) => {
    const id = record.values[systemKey];
    onChange(
      upsertSectionRecord(values, {
        ...record,
        values: { ...record.values, [systemKey]: "" },
        attachments: (record.attachments ?? []).filter((a) => a.id !== id),
      }),
    );
  };

  const renderField = (field: ResolvedField, record: SectionRecord) => {
    const fieldId = fieldDomId(record, field.systemKey);
    const storedValue = record.values[field.systemKey] ?? "";
    const error =
      errors[errorKey(record.id, field.systemKey)] ?? externalErrorFor(record, field.systemKey);
    const previousAnswer = field.previousAnswers?.find(
      (answer) => answer.recordId === record.id && answer.value === storedValue,
    );
    const recordReferenceEntry = recordReferenceCatalog.get(field.systemKey);
    const recordReference = recordReferenceEntry
      ? {
          options: recordReferenceEntry.options,
          unavailableValue:
            storedValue && !recordReferenceEntry.optionValues.has(storedValue)
              ? storedValue
              : null,
        }
      : undefined;

    if (field.type === "file") {
      const attachmentRef: AttachmentRef | null =
        record.attachments?.find((a) => a.id === storedValue) ?? null;
      return (
        <Field
          key={field.systemKey}
          fieldId={fieldId}
          label={field.label}
          helperText={field.helperText}
          error={error}
        >
          <FileField
            fieldId={fieldId}
            attachment={attachmentRef}
            onAttach={(ref) => attachFileToRecord(record, field.systemKey, ref)}
            onRemove={() => removeFileFromRecord(record, field.systemKey)}
          />
        </Field>
      );
    }

    if (field.type === "path") {
      return (
        <Field
          key={field.systemKey}
          fieldId={fieldId}
          label={field.label}
          helperText={field.helperText}
          error={error}
        >
          <PathField
            fieldId={fieldId}
            value={storedValue}
            describedBy={field.helperText ? `${fieldId}-hint` : undefined}
            onChange={(value) => updateRecordValue(record, field.systemKey, value)}
          />
        </Field>
      );
    }

    return (
      <Field
        key={field.systemKey}
        fieldId={fieldId}
        label={field.label}
        helperText={field.helperText}
        error={error}
      >
        <FieldControl
          field={field}
          fieldId={fieldId}
          value={storedValue}
          describedBy={field.helperText ? `${fieldId}-hint` : undefined}
          onValueChange={(value) => updateRecordValue(record, field.systemKey, value)}
          recordReference={recordReference}
          recordReferenceSourceTitle={recordReferenceEntry?.sourceTitle}
        />
        {previousAnswer ? (
          <p className="field__previous-answer">
            Previous answer (kept as you saved it): {previousAnswer.value}
          </p>
        ) : null}
      </Field>
    );
  };

  const renderGroupFields = (group: ResolvedGroup, record: SectionRecord) =>
    [...group.fields]
      .sort((left, right) => left.order - right.order)
      .filter((field) => !field.hidden)
      .filter((field) => isConditionSatisfied(field.visibleWhen, record.values))
      .map((field) => renderField(field, record));

  const renderRepeatableGroup = (group: ResolvedGroup) => {
    const records = groupRecords(group);
    const visibleFields = group.fields.filter((field) => !field.hidden);
    const errored = erroredGroupRecordIds(group);
    // Until the user touches this group's disclosure (state still undefined),
    // default to expanding the first record with an unresolved required issue
    // so its inline errors are never hidden behind a collapsed row.
    const explicit = expandedByGroup[group.groupKey];
    const autoExpandedId =
      explicit !== undefined ? explicit : (records.find((r) => errored.has(r.id))?.id ?? null);
    return (
      <section className="form-group form-group--repeatable" key={group.groupKey}>
        <h3 className="form-group__title">{group.title}</h3>
        {records.length === 0 ? (
          <p className="record-list__empty-hint">No {group.title} added yet.</p>
        ) : (
          <ul className="record-list__items">
            {records.map((record) => {
              const label = recordSummaryLabel(
                record,
                visibleFields,
                section,
                allSections,
                referenceValues,
              );
              const expanded = autoExpandedId === record.id;
              const usages = pendingDeleteId === record.id ? referenceUsages(record) : [];
              return (
                <li className="record-list__item" key={record.id}>
                  <div className="record-list__row">
                    <button
                      type="button"
                      className="record-list__summary"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedByGroup((previous) => ({
                          ...previous,
                          [group.groupKey]: expanded ? null : record.id,
                        }))
                      }
                    >
                      {label}
                    </button>
                    {!expanded && errored.has(record.id) ? (
                      <span className="record-list__row-error">Required info missing</span>
                    ) : null}
                    <button
                      type="button"
                      className="record-list__action"
                      onClick={() => duplicateGroupRecord(record)}
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
                      onConfirm={() => deleteGroupRecord(record)}
                      onCancel={() => setPendingDeleteId(null)}
                    />
                  ) : null}
                  {expanded ? (
                    <div className="record-list__editor">{renderGroupFields(group, record)}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="record-list__add"
          onClick={() => addGroupRecord(group)}
        >
          Add {group.title}
        </button>
      </section>
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSave) {
      return;
    }
    const nextErrors: Record<string, string> = {};
    for (const group of sortedGroups) {
      const records = group.repeatable ? groupRecords(group) : [boundRecord];
      for (const record of records) {
        for (const field of group.fields) {
          if (field.hidden || !field.required) {
            continue;
          }
          if (!isConditionSatisfied(field.visibleWhen, record.values)) {
            // Required + hidden-by-condition validates as not-required.
            continue;
          }
          if ((record.values[field.systemKey] ?? "").trim().length === 0) {
            nextErrors[errorKey(record.id, field.systemKey)] = `${field.label} is required.`;
          }
        }
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      onSave(values);
    }
  };

  return (
    <form className="form-renderer" noValidate onSubmit={handleSubmit}>
      {sortedGroups.map((group) =>
        group.repeatable ? (
          renderRepeatableGroup(group)
        ) : (
          <section className="form-group" key={group.groupKey}>
            <h3 className="form-group__title">{group.title}</h3>
            {renderGroupFields(group, boundRecord)}
          </section>
        ),
      )}
      {onSave ? (
        <div className="form-renderer__actions">
          <button type="submit" className="form-renderer__save">
            Save
          </button>
        </div>
      ) : null}
    </form>
  );
}
