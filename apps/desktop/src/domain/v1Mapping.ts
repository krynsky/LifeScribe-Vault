/**
 * Pure field-level mapping from v1 snapshot data to v2 VaultValues records.
 *
 * The v1 snapshot is returned by the Rust import command as raw JSON. This
 * module produces v2 FieldRecord objects that can be merged into an existing
 * VaultValues object via mergeImportedValues.
 *
 * Mapping rules:
 * - digital-executors: one v2 record per v1 Person with role
 *   "primary_executor" or "backup_executor"; other roles are ignored.
 * - password-manager: first v1 PasswordManagerPlan → singleton plan group.
 * - documents: one v2 record per v1 DocumentRecord.
 * - backups: one v2 record per v1 BackupRecord.
 * - customFieldValues: best-effort; real v1 vaults likely have none due to
 *   v1's field-stripping bug — the dry-run report says whether any exist.
 */

import type { AttachmentRef, SectionRecord, SectionValues, VaultValues } from "./valuesStore";

// ---------------------------------------------------------------------------
// v1 type shapes (raw JSON from Rust — camelCase as per v1 serde)
// ---------------------------------------------------------------------------

export interface V1Person {
  id: string;
  role: string;
  fullName: string;
  relationship?: string;
  contact?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  stepInNotes?: string;
  informed?: boolean;
  lastConfirmedAt?: string;
}

export interface V1PasswordManagerPlan {
  id: string;
  provider: string;
  accountIdentifier?: string;
  emergencyAccessMethod?: string;
  recoveryMaterialLocation?: string;
  twoFactorNotes?: string;
  trustedEmergencyContact?: string;
  accessTested?: boolean;
  lastTestedAt?: string;
  executorInstructions?: string;
}

export interface V1DocumentRecord {
  id: string;
  title: string;
  category?: string;
  location?: string;
  handlingInstructions?: string;
  notes?: string;
  attachmentIds?: string[];
}

export interface V1BackupRecord {
  id: string;
  label: string;
  kind?: string;
  location?: string;
  restoreNotes?: string;
  lastVerifiedAt?: string;
}

export interface V1AttachmentMeta {
  id: string;
  recordId?: string;
  fileName?: string;
  sizeBytes?: number;
}

export interface V1Snapshot {
  profile?: { ownerName?: string };
  people?: V1Person[];
  passwordManagerPlans?: V1PasswordManagerPlan[];
  documents?: V1DocumentRecord[];
  backups?: V1BackupRecord[];
  attachments?: V1AttachmentMeta[];
  customFieldValues?: Record<string, Record<string, string>>;
}

export interface V1AttachmentImported {
  v1Id: string;
  v2Id: string;
  fileName: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Dry-run report
// ---------------------------------------------------------------------------

export interface V1SectionReport {
  sectionKey: string;
  sectionTitle: string;
  itemCount: number;
  unmappableFields: string[];
}

export interface V1DryRunReport {
  sections: V1SectionReport[];
  totalAttachments: number;
  customFieldCount: number;
  ownerName: string;
}

// ---------------------------------------------------------------------------
// Mapping result
// ---------------------------------------------------------------------------

export interface V1MappedSection {
  sectionKey: string;
  records: SectionRecord[];
}

export interface V1MappingResult {
  sections: V1MappedSection[];
  dryRunReport: V1DryRunReport;
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

/** Produce a dry-run report from a v1 snapshot (no side-effects). */
export function buildDryRunReport(
  snapshot: V1Snapshot,
  attachmentIdMap: V1AttachmentImported[],
): V1DryRunReport {
  const sections: V1SectionReport[] = [];

  const executors = (snapshot.people ?? []).filter(
    (p) => p.role === "primary_executor" || p.role === "backup_executor",
  );
  if (executors.length > 0) {
    sections.push({
      sectionKey: "digital-executors",
      sectionTitle: "Digital Executors",
      itemCount: executors.length,
      unmappableFields: [],
    });
  }

  const plans = snapshot.passwordManagerPlans ?? [];
  if (plans.length > 0) {
    sections.push({
      sectionKey: "password-manager",
      sectionTitle: "Password Manager Plan",
      itemCount: 1,
      unmappableFields: plans.length > 1 ? ["extra plans (only first imported)"] : [],
    });
  }

  const docs = snapshot.documents ?? [];
  if (docs.length > 0) {
    sections.push({
      sectionKey: "documents",
      sectionTitle: "Documents & Locations",
      itemCount: docs.length,
      unmappableFields: [],
    });
  }

  const backups = snapshot.backups ?? [];
  if (backups.length > 0) {
    sections.push({
      sectionKey: "backups",
      sectionTitle: "Backups & Storage",
      itemCount: backups.length,
      unmappableFields: [],
    });
  }

  const customFieldCount = Object.values(snapshot.customFieldValues ?? {}).reduce(
    (sum, fields) => sum + Object.keys(fields).length,
    0,
  );

  return {
    sections,
    totalAttachments: attachmentIdMap.length,
    customFieldCount,
    ownerName: snapshot.profile?.ownerName ?? "",
  };
}

/** Map v1 snapshot data to v2 FieldRecord lists, one per section. */
export function mapV1ToV2(
  snapshot: V1Snapshot,
  attachmentIdMap: V1AttachmentImported[],
): V1MappingResult {
  const idMap = new Map(attachmentIdMap.map((a) => [a.v1Id, a]));
  const sections: V1MappedSection[] = [];

  // --- digital-executors ---
  const executors = (snapshot.people ?? []).filter(
    (p) => p.role === "primary_executor" || p.role === "backup_executor",
  );
  if (executors.length > 0) {
    sections.push({
      sectionKey: "digital-executors",
      records: executors.map((p) => mapExecutor(p)),
    });
  }

  // --- password-manager ---
  const plans = snapshot.passwordManagerPlans ?? [];
  if (plans.length > 0) {
    sections.push({
      sectionKey: "password-manager",
      records: [mapPasswordManagerPlan(plans[0])],
    });
  }

  // --- documents ---
  const docs = snapshot.documents ?? [];
  if (docs.length > 0) {
    sections.push({
      sectionKey: "documents",
      records: docs.map((d) => mapDocument(d, idMap)),
    });
  }

  // --- backups ---
  const backups = snapshot.backups ?? [];
  if (backups.length > 0) {
    sections.push({
      sectionKey: "backups",
      records: backups.map((b) => mapBackup(b)),
    });
  }

  return {
    sections,
    dryRunReport: buildDryRunReport(snapshot, attachmentIdMap),
  };
}

/**
 * Merge imported records into existing VaultValues.
 * Multi-record sections always append; the caller decides before calling
 * whether to pass `clearSections` for single-record sections that need
 * overwrite (password-manager).
 */
export function mergeImportedValues(
  existing: VaultValues,
  imported: V1MappedSection[],
  clearSections: string[],
): VaultValues {
  const next = { ...existing };
  for (const { sectionKey, records } of imported) {
    if (records.length === 0) continue;
    const shouldClear = clearSections.includes(sectionKey);
    const current: SectionValues = next[sectionKey] ?? {
      sectionKey,
      records: [],
      archivedAnswers: [],
    };
    next[sectionKey] = {
      ...current,
      records: [
        ...(shouldClear ? [] : (current.records ?? [])),
        ...records,
      ],
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Per-record mappers
// ---------------------------------------------------------------------------

const IMPORT_SCHEMA_VERSION = 1;

function mapExecutor(p: V1Person): SectionRecord {
  const role = p.role === "backup_executor" ? "backup" : "primary";
  const values: Record<string, string> = {
    executorRole: role,
  };
  if (p.fullName) values["executorName"] = p.fullName;
  if (p.relationship) values["executorRelationship"] = p.relationship;
  if (p.address) values["executorAddress"] = p.address;
  if (p.city) values["executorCity"] = p.city;
  if (p.state) values["executorState"] = p.state;
  if (p.zipCode) values["executorZipCode"] = p.zipCode;
  if (p.phone) values["executorPhoneNumber"] = p.phone;
  if (p.email) values["executorEmail"] = p.email;
  // v1 "contact" (free text) → executorResponsibilities
  if (p.contact) values["executorResponsibilities"] = p.contact;
  if (p.stepInNotes) values["executorStepIn"] = p.stepInNotes;
  if (p.informed !== undefined) {
    values["executorInformed"] = p.informed ? "informed" : "not-informed";
  }
  if (p.lastConfirmedAt) values["executorLastConfirmedAt"] = p.lastConfirmedAt;

  return { id: crypto.randomUUID(), schemaVersion: IMPORT_SCHEMA_VERSION, values };
}

function mapPasswordManagerPlan(plan: V1PasswordManagerPlan): SectionRecord {
  const values: Record<string, string> = {};
  if (plan.provider) {
    // "Other" stays as-is; known providers map directly.
    values["passwordManagerProvider"] = plan.provider;
  }
  if (plan.accountIdentifier) values["passwordManagerAccountIdentifier"] = plan.accountIdentifier;
  if (plan.emergencyAccessMethod) values["passwordManagerEmergencyAccess"] = plan.emergencyAccessMethod;
  if (plan.recoveryMaterialLocation) values["passwordManagerRecoveryLocation"] = plan.recoveryMaterialLocation;
  if (plan.twoFactorNotes) values["passwordManagerTwoFactorNotes"] = plan.twoFactorNotes;
  if (plan.trustedEmergencyContact) values["passwordManagerTrustedEmergencyContact"] = plan.trustedEmergencyContact;
  if (plan.accessTested !== undefined) {
    values["passwordManagerAccessTested"] = plan.accessTested ? "tested" : "not-tested";
  }
  if (plan.lastTestedAt) values["passwordManagerLastTestedAt"] = plan.lastTestedAt;
  if (plan.executorInstructions) values["passwordManagerExecutorInstructions"] = plan.executorInstructions;

  return { id: crypto.randomUUID(), schemaVersion: IMPORT_SCHEMA_VERSION, values };
}

function mapDocument(
  doc: V1DocumentRecord,
  idMap: Map<string, V1AttachmentImported>,
): SectionRecord {
  const values: Record<string, string> = {};
  if (doc.title) values["documentTitle"] = doc.title;
  if (doc.category) values["documentCategory"] = doc.category;
  // v1 "location" → v2 "documentPhysicalLocation"
  if (doc.location) values["documentPhysicalLocation"] = doc.location;
  if (doc.handlingInstructions) values["documentHandlingInstructions"] = doc.handlingInstructions;
  if (doc.notes) values["documentNotes"] = doc.notes;

  const attachments: AttachmentRef[] = (doc.attachmentIds ?? [])
    .map((v1Id) => idMap.get(v1Id))
    .filter((a): a is V1AttachmentImported => a !== undefined)
    .map((a) => ({ id: a.v2Id, fileName: a.fileName, sizeBytes: a.sizeBytes }));

  return {
    id: crypto.randomUUID(),
    schemaVersion: IMPORT_SCHEMA_VERSION,
    values,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function mapBackup(backup: V1BackupRecord): SectionRecord {
  const values: Record<string, string> = {};
  if (backup.label) values["backupLabel"] = backup.label;
  // v1 "kind" → v2 "backupType" (same select option values)
  if (backup.kind) values["backupType"] = backup.kind;
  if (backup.location) values["backupLocation"] = backup.location;
  if (backup.restoreNotes) values["backupRestoreNotes"] = backup.restoreNotes;
  if (backup.lastVerifiedAt) values["backupLastVerifiedAt"] = backup.lastVerifiedAt;

  return { id: crypto.randomUUID(), schemaVersion: IMPORT_SCHEMA_VERSION, values };
}
