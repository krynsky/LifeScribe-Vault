/**
 * Unlocked dashboard (U5): guided-checklist sidebar driven by the generic
 * readiness model, section pages with CAS saves, the lock flow
 * (in-flight save completes -> dirty draft stashed encrypted -> key
 * zeroized), draft restore, and the recovered-save / merge-notice banners.
 *
 * Checklist law: status badges and the readiness percentage derive from
 * SAVED data only — transient form edits live in `workingValues` and never
 * move a badge until they are persisted.
 */

import { useEffect, useRef, useState } from "react";
import {
  deleteAttachment,
  discardDraft,
  loadVaultSnapshot,
  lockVault,
  saveVaultSnapshot,
  stashDraft,
  sweepOrphanedAttachments,
  takeDraft,
  type VaultSnapshot,
} from "../api/vaultApi";
import { collectAttachmentIds, droppedAttachmentIds } from "../domain/attachmentRefs";
import { AppShell } from "../components/AppShell";
import { StatusBadge } from "../components/StatusBadge";
import {
  addOptionalField,
  addSection,
  ensureSectionHasGroup,
  removeField,
  setSectionEntryLabel,
  setSectionMultiRecord,
  updateSection,
  updateField,
} from "../creator/packEdits";
import { duplicateField, reorderFields } from "../forms/structure/fieldOps";
import { deriveAutoMigration } from "../creator/packAutoMigrate";
import { buildDraftPayload, parseDraftPayload } from "../domain/draft";
import type { FormPack, MergeNotice, ResolvedSection, UserOverlay } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
import { composePack } from "../domain/composePack";
import { migrateVaultValues } from "../domain/packMigrations";
import { mergePackWithOverlay } from "../domain/packMerge";
import {
  readinessSummary,
  sectionStatus,
  type SectionStatus,
} from "../domain/readiness";
import { computeKitFingerprint, isKitStale } from "../domain/recoveryKit";
import {
  buildSnapshot,
  normalizeSnapshot,
  SNAPSHOT_FORMAT,
  type FormMode,
  type KitMeta,
  type ParsedSnapshot,
  type SectionMetaMap,
  type VaultProfile,
} from "../domain/snapshot";
import {
  validateSectionValues,
  type SectionValidationIssue,
} from "../domain/sectionValidation";
import {
  applyKeyRenames,
  createSectionValues,
  reconcileSectionValues,
  type SectionValues,
  type VaultValues,
} from "../domain/valuesStore";
import { BackupPage } from "./BackupPage";
import { RecoveryKitPage } from "./RecoveryKitPage";

import { SectionPage, type DraftBannerState } from "./SectionPage";
import { ACTIVITY_EVENTS, INACTIVITY_LOCK_MS } from "./lockPolicy";

export interface DashboardProps {
  /** Owner name from the setup flow, used until the first snapshot exists. */
  ownerNameHint?: string;
  /** Form mode chosen at setup; consumed by Task 5. */
  formModeHint?: FormMode;
  /** Called once the vault is locked (auto or manual). */
  onLocked: () => void;
}

type Route =
  | { kind: "welcome" }
  | { kind: "section"; sectionKey: string }
  | { kind: "recovery-kit" }
  | { kind: "backup" };

interface VaultState {
  generation: number;
  recovered: boolean;
  profile: VaultProfile;
  sectionMeta: SectionMetaMap;
  savedValues: VaultValues;
  overlay: UserOverlay | null;
  kitMeta: KitMeta | null;
  extra: Record<string, unknown>;
  customPack: FormPack | null;
}

interface LoadedVault {
  sections: ResolvedSection[];
  notices: MergeNotice[];
  schemaVersion: number;
  pack: FormPack;
  vault: VaultState;
}

interface DraftRestoreState extends DraftBannerState {
  sectionKey: string;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pack this vault renders from: the saved customPack (form-editor edits) or
 * the bundled base pack, composed with the profile's module selections. Legacy
 * customPacks predate modules (base.modules undefined) so compose is a no-op for
 * them — they already baked in their mode's fields.
 */
async function resolveBasePack(parsed: ParsedSnapshot): Promise<FormPack> {
  const base = parsed.customPack ?? (await loadDefaultPack());
  return composePack(base, base.modules ?? [], parsed.profile.moduleSelections);
}

/**
 * The load pipeline after normalization: merge pack+overlay -> re-key
 * renamed custom fields -> migrate-on-read (in memory only) -> reconcile
 * records against the resolved definition. Pure; persists nothing.
 *
 * Callers produce `parsed` via `normalizeSnapshot(raw, ownerNameHint,
 * formModeHint)` — the hints seed the profile only for a fresh vault (raw
 * null, or a snapshot with no persisted formMode); an existing snapshot
 * keeps its own values. Without the formMode hint the onboarding choice
 * would never reach the profile and the first save would persist "hint",
 * silently discarding it.
 */
function buildLoadedVault(
  pack: FormPack,
  parsed: ParsedSnapshot,
  generation: number,
  recovered: boolean,
): LoadedVault | { blocked: string } {
  const merge = mergePackWithOverlay(pack, parsed.overlay, parsed.values);
  let values = applyKeyRenames(parsed.values, merge.keyRenames);

  const migrated = migrateVaultValues(values, pack);
  if (!migrated.ok) {
    return { blocked: migrated.error.message };
  }
  values = migrated.values;

  const reconciled: VaultValues = {};
  for (const section of merge.resolved.sections) {
    const sectionValues = values[section.sectionKey];
    if (sectionValues) {
      reconciled[section.sectionKey] = reconcileSectionValues(
        sectionValues,
        section,
      ).sectionValues;
    }
  }
  // Values for sections the pack no longer ships are retained untouched.
  for (const [sectionKey, sectionValues] of Object.entries(values)) {
    if (!(sectionKey in reconciled)) {
      reconciled[sectionKey] = sectionValues;
    }
  }

  return {
    sections: merge.resolved.sections,
    notices: merge.notices,
    schemaVersion: pack.schemaVersion,
    pack,
    vault: {
      generation,
      recovered,
      // Stamp the resolved pack's id so every save records which base pack
      // this vault derives from (see VaultProfile.basePackId).
      profile: { ...parsed.profile, basePackId: pack.packId },
      sectionMeta: parsed.sectionMeta,
      savedValues: reconciled,
      overlay: merge.overlay.sections.length > 0 ? merge.overlay : null,
      kitMeta: parsed.kitMeta,
      extra: parsed.extra,
      customPack: parsed.customPack ?? null,
    },
  };
}

export function Dashboard({ ownerNameHint = "", formModeHint = "hint", onLocked }: DashboardProps) {
  const [phase, setPhase] = useState<"loading" | "ready" | "blocked" | "error">("loading");
  const [blockedMessage, setBlockedMessage] = useState("");
  const [loaded, setLoaded] = useState<LoadedVault | null>(null);
  const [workingValues, setWorkingValues] = useState<Record<string, SectionValues>>({});
  const [route, setRoute] = useState<Route>({ kind: "welcome" });
  const [saving, setSaving] = useState(false);
  const [conflictSection, setConflictSection] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<SectionValidationIssue[]>([]);
  const [draftRestore, setDraftRestore] = useState<DraftRestoreState | null>(null);
  const [corruptDraftNotice, setCorruptDraftNotice] = useState(false);
  const [recoveredDismissed, setRecoveredDismissed] = useState(false);
  const [noticesDismissed, setNoticesDismissed] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [locking, setLocking] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [packEditorEnabled, setPackEditorEnabled] = useState(
    () => localStorage.getItem("lifescribe.packEditorEnabled") === "true",
  );
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [workingPack, setWorkingPack] = useState<FormPack | null>(null);
  const [packEditError, setPackEditError] = useState<string | null>(null);
  const [pendingModeSwitch, setPendingModeSwitch] = useState<FormMode | null>(null);

  // Refs mirror the state the async lock path needs (timer callbacks must
  // not see stale closures).
  const workingRef = useRef(workingValues);
  useEffect(() => {
    workingRef.current = workingValues;
  }, [workingValues]);
  const saveInFlightRef = useRef<Promise<unknown> | null>(null);
  const lockingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Initial load: snapshot, merge pipeline, then the stashed draft (if any).
  // -------------------------------------------------------------------------
  useEffect(() => {
    let isCurrent = true;

    async function load() {
      let raw: VaultSnapshot | null = null;
      let generation = 0;
      let recovered = false;

      try {
        const response = await loadVaultSnapshot();
        raw = response.snapshot;
        generation = response.generation;
        recovered = response.recovered;
      } catch (error) {
        if (errorCode(error) !== "NotFound") {
          if (isCurrent) setPhase("error");
          return;
        }
        // Fresh vault: no snapshot saved yet; base generation stays 0.
      }

      // Use the user's personal pack if saved, else fall back to the bundled
      // default for the mode stored in the snapshot (or the prop hint when
      // the vault is new).
      const parsed = normalizeSnapshot(raw, ownerNameHint, formModeHint);
      let pack: FormPack;
      try {
        pack = await resolveBasePack(parsed);
      } catch {
        if (isCurrent) setPhase("error");
        return;
      }

      const result = buildLoadedVault(pack, parsed, generation, recovered);
      if (!isCurrent) {
        return;
      }
      if ("blocked" in result) {
        setBlockedMessage(result.blocked);
        setPhase("blocked");
        return;
      }
      setLoaded(result);
      setPhase("ready");

      // Restore a stashed draft FIRST (corrupt stashes surface, never
      // vanish), so the orphan sweep below also sees attachments that are
      // referenced only by the draft — sweeping them here would leave the
      // restored draft pointing at a deleted file.
      const draftAttachmentIds: string[] = [];
      try {
        const taken = await takeDraft();
        if (!isCurrent) {
          return;
        }
        if (taken.corrupt) {
          setCorruptDraftNotice(true);
          // Surfaced this session; discard so it does not re-surface forever.
          void discardDraft().catch(() => undefined);
        } else if (taken.draft) {
          const parsedDraft = parseDraftPayload(taken.draft);
          const known = parsedDraft.sections.filter((entry) =>
            result.sections.some((section) => section.sectionKey === entry.sectionKey),
          );
          if (known.length > 0) {
            draftAttachmentIds.push(
              ...collectAttachmentIds(known.map((entry) => entry.values)),
            );
            setWorkingValues((previous) => {
              const next = { ...previous };
              for (const entry of known) {
                next[entry.sectionKey] = entry.values;
              }
              return next;
            });
            setRoute({ kind: "section", sectionKey: known[0].sectionKey });
            setDraftRestore({
              sectionKey: known[0].sectionKey,
              stashedAt: taken.stashedAt,
              stale: taken.staleGeneration,
            });
          }
        }
      } catch {
        // Draft restore is best-effort; the vault itself loaded fine.
      }

      // Orphan sweep: remove ciphertext files referenced neither by any
      // snapshot record nor by the restored draft. Runs once here — after
      // unlock + load — never while locked (the reference set doesn't exist
      // while locked).
      const referencedIds = [
        ...collectAttachmentIds(Object.values(result.vault.savedValues)),
        ...draftAttachmentIds,
      ];
      void sweepOrphanedAttachments(referencedIds).catch(() => undefined);
    }

    void load();
    return () => {
      isCurrent = false;
    };
  }, [ownerNameHint, formModeHint, loadKey]);

  // -------------------------------------------------------------------------
  // Lock flow: in-flight save completes -> dirty draft stashed (encrypted
  // with the still-live data key) -> lock zeroizes the key.
  // -------------------------------------------------------------------------
  const performLock = async () => {
    if (lockingRef.current) {
      return;
    }
    lockingRef.current = true;
    setLocking(true);

    if (saveInFlightRef.current) {
      try {
        await saveInFlightRef.current;
      } catch {
        // The save's own error handling already ran; locking proceeds.
      }
    }

    const dirtyEntries = Object.entries(workingRef.current);
    if (dirtyEntries.length > 0) {
      const payload = buildDraftPayload(
        dirtyEntries.map(([sectionKey, values]) => ({ sectionKey, values })),
        new Date().toISOString(),
      );
      try {
        await stashDraft(payload);
      } catch {
        // Stash failed (e.g. disk). Locking still must happen — holding the
        // key (and plaintext) in memory would violate the security model.
      }
    }

    try {
      await lockVault();
    } catch {
      // Even if the IPC errors, treat the session as locked in the UI.
    }
    onLocked();
  };
  const performLockRef = useRef(performLock);
  useEffect(() => {
    performLockRef.current = performLock;
  });

  // Inactivity auto-lock. Mounted only with the dashboard, so it is
  // structurally inert on the setup and locked screens.
  useEffect(() => {
    let timer: number | undefined;
    const fire = () => {
      void performLockRef.current();
    };
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, INACTIVITY_LOCK_MS);
    };
    reset();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, reset);
    }
    return () => {
      window.clearTimeout(timer);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, reset);
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Saving (generation-counted compare-and-swap)
  // -------------------------------------------------------------------------

  function assembleSnapshot(
    current: LoadedVault,
    values: VaultValues,
    sectionMeta: SectionMetaMap,
    kitMeta: KitMeta | null,
  ): VaultSnapshot {
    return buildSnapshot({
      snapshotFormat: SNAPSHOT_FORMAT,
      schemaVersion: current.schemaVersion,
      profile: current.vault.profile,
      values,
      sectionMeta,
      overlay: current.vault.overlay,
      kitMeta,
      extra: current.vault.extra,
      customPack: current.vault.customPack ?? undefined,
    });
  }

  /** CAS save against an explicit base; commits state on success. */
  async function persist(
    base: LoadedVault,
    nextValues: VaultValues,
    nextMeta: SectionMetaMap,
    savedSectionKey: string | null,
    nextKitMeta: KitMeta | null = base.vault.kitMeta,
  ): Promise<boolean> {
    setSaving(true);
    setSaveError("");
    const promise = saveVaultSnapshot(
      assembleSnapshot(base, nextValues, nextMeta, nextKitMeta),
      base.vault.generation,
    );
    saveInFlightRef.current = promise;
    try {
      const { generation } = await promise;
      // The save has committed: attachment files the previous saved snapshot
      // referenced but this one no longer does are now safe to delete. (UI
      // remove/replace never deletes eagerly — see attachmentRefs.ts.)
      for (const id of droppedAttachmentIds(base.vault.savedValues, nextValues)) {
        void deleteAttachment(id).catch(() => undefined);
      }
      setLoaded({
        ...base,
        vault: {
          ...base.vault,
          generation,
          recovered: false,
          savedValues: nextValues,
          sectionMeta: nextMeta,
          kitMeta: nextKitMeta,
        },
      });
      if (savedSectionKey) {
        setWorkingValues((previous) => {
          const next = { ...previous };
          delete next[savedSectionKey];
          return next;
        });
        setConflictSection((current) =>
          current === savedSectionKey ? null : current,
        );
      }
      // A successful save purges any stashed draft.
      setDraftRestore(null);
      void discardDraft().catch(() => undefined);
      return true;
    } catch (error) {
      if (errorCode(error) === "SnapshotConflict" && savedSectionKey) {
        setConflictSection(savedSectionKey);
      } else {
        setSaveError("Your changes could not be saved. Please try again.");
      }
      return false;
    } finally {
      saveInFlightRef.current = null;
      setSaving(false);
    }
  }

  async function handleSavePack(newPack: FormPack): Promise<boolean> {
    if (!loaded) return false;
    const nextLoaded: LoadedVault = {
      ...loaded,
      pack: newPack,
      vault: { ...loaded.vault, customPack: newPack },
    };
    const ok = await persist(
      nextLoaded,
      loaded.vault.savedValues,
      loaded.vault.sectionMeta,
      null,
    );
    if (ok) {
      // Reload so sections rebuild from the new pack.
      setPhase("loading");
      setLoadKey((k) => k + 1);
    }
    return ok;
  }

  async function handleSwitchMode(newMode: FormMode) {
    if (!loaded || loaded.vault.profile.formMode === newMode) {
      setPendingModeSwitch(null);
      return;
    }
    // New mode, customPack cleared; saved through the common `persist` path
    // so the save registers in saveInFlightRef (the lock flow awaits it) and
    // purges any stashed draft like every other committed save.
    // Best-effort: stamp the new mode's default pack id; if the pack can't
    // be loaded the id is dropped and the post-reload save re-stamps it.
    let nextBasePackId: string | undefined;
    try {
      nextBasePackId = (await loadDefaultPack(newMode)).packId;
    } catch {
      nextBasePackId = undefined;
    }
    const nextLoaded: LoadedVault = {
      ...loaded,
      vault: {
        ...loaded.vault,
        profile: {
          ...loaded.vault.profile,
          formMode: newMode,
          moduleSelections: { ...loaded.vault.profile.moduleSelections, secrets: newMode === "credential" ? "on" : "off" },
          basePackId: nextBasePackId,
        },
        customPack: null,
      },
    };
    const ok = await persist(
      nextLoaded,
      loaded.vault.savedValues,
      loaded.vault.sectionMeta,
      null,
    );
    if (ok) {
      // Reload so sections rebuild from the new mode's pack.
      setPhase("loading");
      setLoadKey((k) => k + 1);
    }
    setPendingModeSwitch(null);
  }

  function sectionWorkingValues(sectionKey: string): SectionValues {
    return (
      workingValues[sectionKey] ??
      loaded?.vault.savedValues[sectionKey] ??
      createSectionValues(sectionKey)
    );
  }

  async function handleSaveSection(sectionKey: string) {
    if (!loaded) {
      return;
    }
    const section = loaded.sections.find((entry) => entry.sectionKey === sectionKey);
    if (!section) {
      return;
    }
    const sectionValues = sectionWorkingValues(sectionKey);
    const issues = validateSectionValues(section, sectionValues);
    setValidationIssues(issues);
    if (issues.length > 0) {
      return;
    }
    const now = new Date().toISOString();
    await persist(
      loaded,
      { ...loaded.vault.savedValues, [sectionKey]: sectionValues },
      {
        ...loaded.vault.sectionMeta,
        [sectionKey]: { ...loaded.vault.sectionMeta[sectionKey], lastSavedAt: now },
      },
      sectionKey,
    );
  }

  /** Conflict resolution: re-apply the form values onto a fresh load. */
  async function handleSaveAgain(sectionKey: string) {
    if (!loaded) {
      return;
    }
    let fresh: LoadedVault;
    try {
      const response = await loadVaultSnapshot();
      const parsed = normalizeSnapshot(response.snapshot, ownerNameHint, formModeHint);
      const pack = await resolveBasePack(parsed);
      const result = buildLoadedVault(pack, parsed, response.generation, response.recovered);
      if ("blocked" in result) {
        setBlockedMessage(result.blocked);
        setPhase("blocked");
        return;
      }
      fresh = result;
    } catch {
      setSaveError("The latest vault data could not be loaded. Please try again.");
      return;
    }
    setLoaded(fresh);
    setConflictSection(null);

    const sectionValues = workingRef.current[sectionKey];
    if (!sectionValues) {
      return;
    }
    const now = new Date().toISOString();
    await persist(
      fresh,
      { ...fresh.vault.savedValues, [sectionKey]: sectionValues },
      {
        ...fresh.vault.sectionMeta,
        [sectionKey]: { ...fresh.vault.sectionMeta[sectionKey], lastSavedAt: now },
      },
      sectionKey,
    );
  }

  /** Conflict resolution: drop the edits and reload the latest data. */
  async function handleDiscardConflict(sectionKey: string) {
    try {
      const response = await loadVaultSnapshot();
      const parsed = normalizeSnapshot(response.snapshot, ownerNameHint, formModeHint);
      const pack = await resolveBasePack(parsed);
      const result = buildLoadedVault(pack, parsed, response.generation, response.recovered);
      if ("blocked" in result) {
        setBlockedMessage(result.blocked);
        setPhase("blocked");
        return;
      }
      setLoaded(result);
    } catch {
      setSaveError("The latest vault data could not be loaded. Please try again.");
      return;
    }
    setWorkingValues((previous) => {
      const next = { ...previous };
      delete next[sectionKey];
      return next;
    });
    setConflictSection(null);
    setValidationIssues([]);
  }

  async function handleSetNa(sectionKey: string, na: boolean) {
    if (!loaded) {
      return;
    }
    const previousMeta = loaded.vault.sectionMeta[sectionKey] ?? {};
    const nextMeta = { ...previousMeta };
    if (na) {
      nextMeta.na = true;
    } else {
      delete nextMeta.na;
    }
    await persist(
      loaded,
      loaded.vault.savedValues,
      { ...loaded.vault.sectionMeta, [sectionKey]: nextMeta },
      null,
    );
  }

  async function handleMarkReviewed(sectionKey: string) {
    if (!loaded) {
      return;
    }
    const now = new Date().toISOString();
    await persist(
      loaded,
      loaded.vault.savedValues,
      {
        ...loaded.vault.sectionMeta,
        [sectionKey]: { ...loaded.vault.sectionMeta[sectionKey], lastReviewedAt: now },
      },
      null,
    );
  }

  /** Commit the current Kit view: staleness anchor only, values untouched. */
  async function handleSaveKit(nextKitMeta: KitMeta) {
    if (!loaded) {
      return;
    }
    await persist(loaded, loaded.vault.savedValues, loaded.vault.sectionMeta, null, nextKitMeta);
  }

  function handleSectionChange(sectionKey: string, values: SectionValues) {
    setWorkingValues((previous) => ({ ...previous, [sectionKey]: values }));
  }

  function handleDiscardDraft() {
    if (!draftRestore) {
      return;
    }
    setWorkingValues((previous) => {
      const next = { ...previous };
      delete next[draftRestore.sectionKey];
      return next;
    });
    setDraftRestore(null);
    void discardDraft().catch(() => undefined);
  }

  function handlePackEditorToggle(enabled: boolean) {
    setPackEditorEnabled(enabled);
    localStorage.setItem("lifescribe.packEditorEnabled", String(enabled));
    if (!enabled) {
      setEditingSectionKey(null);
      setWorkingPack(null);
      setPackEditError(null);
    }
  }

  function handleEnterSectionEdit(sectionKey: string) {
    if (!loaded) return;
    setEditingSectionKey(sectionKey);
    // Heal any section previously persisted without a group so it becomes
    // editable and savable (older addSection created groupless sections).
    setWorkingPack(ensureSectionHasGroup(loaded.pack, sectionKey));
    setPackEditError(null);
  }

  function handleCancelSectionEdit() {
    setEditingSectionKey(null);
    setWorkingPack(null);
    setPackEditError(null);
  }

  async function handleSaveFormChanges() {
    if (!loaded || !workingPack) return;
    const result = deriveAutoMigration(loaded.pack, workingPack);
    if (!result.ok) {
      setPackEditError(result.error);
      return;
    }
    const ok = await handleSavePack(result.pack);
    if (ok !== false) {
      setEditingSectionKey(null);
      setWorkingPack(null);
      setPackEditError(null);
    }
  }

  function handleEditField(sectionKey: string, groupKey: string, updatedField: import("../domain/formModel").FieldDefinition) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return updateField(prev, sectionKey, groupKey, updatedField.systemKey, () => updatedField);
    });
  }

  function handleRemoveField(sectionKey: string, groupKey: string, systemKey: string) {
    // Computed outside the setState updater: updaters must stay pure
    // (StrictMode double-invokes them), and removeField can throw.
    if (!workingPack) return;
    try {
      setWorkingPack(removeField(workingPack, sectionKey, groupKey, systemKey));
      setPackEditError(null);
    } catch (err) {
      setPackEditError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDuplicateField(sectionKey: string, groupKey: string, systemKey: string) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return duplicateField(prev, sectionKey, groupKey, systemKey);
    });
  }

  function handleReorderField(
    sectionKey: string,
    groupKey: string,
    fromIndex: number,
    toIndex: number,
  ) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return reorderFields(prev, sectionKey, groupKey, fromIndex, toIndex);
    });
  }

  function handleAddField(
    sectionKey: string,
    groupKey: string,
    type: import("../domain/formModel").FieldType,
  ) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return addOptionalField(prev, sectionKey, groupKey, type);
    });
  }

  function handleEditSectionTitle(sectionKey: string, title: string) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return updateSection(prev, sectionKey, (s) => ({ ...s, title }));
    });
  }

  function handleEditSectionLede(sectionKey: string, lede: string) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return updateSection(prev, sectionKey, (s) => ({ ...s, lede }));
    });
  }

  function handleToggleMultiRecord(sectionKey: string, multiRecord: boolean) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return setSectionMultiRecord(prev, sectionKey, multiRecord);
    });
  }

  function handleEditEntryLabel(sectionKey: string, label: string) {
    setWorkingPack((prev) => {
      if (!prev) return prev;
      return setSectionEntryLabel(prev, sectionKey, label);
    });
  }

  async function handleAddSection() {
    if (!loaded) return;
    const newPack = addSection(loaded.pack);
    await handleSavePack(newPack);
  }

  function openSection(sectionKey: string) {
    setValidationIssues([]);
    setRoute({ kind: "section", sectionKey });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === "loading") {
    return (
      <main className="centered-screen" aria-busy="true">
        <p className="app-loading__hint">Opening your vault…</p>
      </main>
    );
  }

  if (phase === "blocked") {
    return (
      <main className="centered-screen">
        <section className="vault-panel" role="alert">
          <p className="vault-panel__eyebrow">LifeScribe Vault</p>
          <h1 className="vault-panel__title">This vault needs a newer app</h1>
          <p className="vault-panel__lede">{blockedMessage}</p>
        </section>
      </main>
    );
  }

  if (phase === "error" || !loaded) {
    return (
      <main className="centered-screen">
        <section className="vault-panel" role="alert">
          <p className="vault-panel__eyebrow">LifeScribe Vault</p>
          <h1 className="vault-panel__title">Something went wrong</h1>
          <p className="vault-panel__lede">
            Your vault could not be opened. Nothing has been changed — lock
            and unlock to try again.
          </p>
        </section>
      </main>
    );
  }

  const now = new Date();
  const cadence = loaded.vault.profile.reviewCadenceMonths;
  const orderedSections = [...loaded.sections].sort((a, b) => a.order - b.order);
  const statusFor = (section: ResolvedSection): SectionStatus =>
    sectionStatus(
      section,
      loaded.vault.savedValues[section.sectionKey],
      loaded.vault.sectionMeta[section.sectionKey],
      cadence,
      now,
    );
  const summary = readinessSummary(
    loaded.sections,
    loaded.vault.savedValues,
    loaded.vault.sectionMeta,
    cadence,
    now,
  );

  // Recovery Kit staleness: derived from SAVED data, like every badge.
  // Stale when a saved Kit exists and its fingerprint no longer matches
  // what the current data produces; a never-saved Kit carries no badge.
  const kitCurrentFingerprint = computeKitFingerprint(
    loaded.sections,
    loaded.vault.savedValues,
    loaded.vault.sectionMeta,
  );
  const kitStale = isKitStale(kitCurrentFingerprint, loaded.vault.kitMeta);

  const sidebar = (
    <div className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">LifeScribe Vault</span>
        {loaded.vault.profile.ownerName ? (
          <span className="sidebar__owner">{loaded.vault.profile.ownerName}</span>
        ) : null}
      </div>

      <div className="sidebar__readiness">
        <div className="sidebar__readiness-row">
          <span>Readiness</span>
          <span className="sidebar__readiness-value">{summary.percent}%</span>
        </div>
        <div
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={summary.percent}
          className="progress"
          role="progressbar"
        >
          <div className="progress__fill" style={{ width: `${summary.percent}%` }} />
        </div>
      </div>

      <nav aria-label="Guided checklist" className="sidebar__nav">
        <p className="sidebar__heading">Guided checklist</p>
        <ul className="sidebar__list">
          {orderedSections.map((section) => {
            const active =
              route.kind === "section" && route.sectionKey === section.sectionKey;
            return (
              <li key={section.sectionKey}>
                <button
                  aria-current={active ? "page" : undefined}
                  className={
                    active ? "sidebar__item sidebar__item--active" : "sidebar__item"
                  }
                  type="button"
                  onClick={() => openSection(section.sectionKey)}
                >
                  <span className="sidebar__item-title">{section.title}</span>
                  <StatusBadge status={statusFor(section)} />
                </button>
              </li>
            );
          })}
        </ul>

        {packEditorEnabled && !editingSectionKey ? (
          <button
            className="sidebar__add-section"
            type="button"
            onClick={() => void handleAddSection()}
          >
            + Add section
          </button>
        ) : null}

        <p className="sidebar__heading">Tools</p>
        <ul className="sidebar__list">
          <li>
            <button
              aria-current={route.kind === "recovery-kit" ? "page" : undefined}
              className={
                route.kind === "recovery-kit"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "recovery-kit" })}
            >
              <span className="sidebar__item-title">Recovery Kit</span>
              {kitStale ? (
                <span className="status-badge status-badge--stale-complete">
                  Kit out of date
                </span>
              ) : null}
            </button>
          </li>
          <li>
            <button
              aria-current={route.kind === "backup" ? "page" : undefined}
              className={
                route.kind === "backup"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "backup" })}
            >
              <span className="sidebar__item-title">Backup</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="sidebar__mode">
        <span className="sidebar__mode-label">Form detail</span>
        <span className="sidebar__mode-current">
          {loaded.vault.profile.formMode === "credential" ? "Stores secrets" : "Locations only"}
        </span>
        <button
          className="button button--secondary button--small"
          type="button"
          onClick={() =>
            setPendingModeSwitch(
              loaded.vault.profile.formMode === "credential" ? "hint" : "credential",
            )
          }
        >
          {loaded.vault.profile.formMode === "credential"
            ? "Switch to locations only"
            : "Switch to store actual secrets"}
        </button>
      </div>

      <div className="sidebar__footer">
        <label className="sidebar__toggle" htmlFor="pack-editor-toggle">
          <input
            id="pack-editor-toggle"
            className="sidebar__toggle-input"
            type="checkbox"
            checked={packEditorEnabled}
            onChange={(e) => handlePackEditorToggle(e.target.checked)}
          />
          <span className="sidebar__toggle-track" aria-hidden="true" />
          <span className="sidebar__toggle-label">Form Editor</span>
        </label>
        <button
          className="button button--secondary sidebar__lock"
          disabled={locking}
          type="button"
          onClick={() => void performLock()}
        >
          {locking ? "Locking…" : "Lock vault"}
        </button>
      </div>
    </div>
  );

  const banners = (
    <>
      {loaded.vault.recovered && !recoveredDismissed ? (
        <div className="banner banner--warning" role="alert">
          <p className="banner__text">
            The most recent save could not be read, so an earlier good save
            was recovered. Your data is intact — consider creating a backup
            now.
          </p>
          <div className="banner__actions">
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => setRecoveredDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {corruptDraftNotice ? (
        <div className="banner banner--warning" role="alert">
          <p className="banner__text">
            A draft from a previous session could not be recovered. Everything
            you saved is intact, but unsaved edits from that session were lost.
          </p>
          <div className="banner__actions">
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => setCorruptDraftNotice(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {loaded.notices.length > 0 && !noticesDismissed ? (
        <div className="banner banner--info" role="status">
          <p className="banner__text">A few things were adjusted while loading your forms:</p>
          <ul className="banner__list">
            {loaded.notices.map((notice, index) => (
              <li key={`${notice.kind}:${notice.sectionKey}:${index}`}>{notice.message}</li>
            ))}
          </ul>
          <div className="banner__actions">
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => setNoticesDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <div className="banner banner--error" role="alert">
          <p className="banner__text">{saveError}</p>
        </div>
      ) : null}
    </>
  );

  let content;
  if (route.kind === "section") {
    const section = orderedSections.find(
      (entry) => entry.sectionKey === route.sectionKey,
    );
    if (section) {
      const isSectionEditing =
        packEditorEnabled && editingSectionKey === section.sectionKey;
      const packSectionForEdit = isSectionEditing && workingPack
        ? workingPack.sections.find((s) => s.sectionKey === section.sectionKey)
        : undefined;

      // When editing, re-resolve from workingPack so structural changes (add/remove/reorder
      // fields) render immediately without waiting for a save.
      const displaySection = isSectionEditing && workingPack
        ? (() => {
            const liveResolve = mergePackWithOverlay(
              workingPack,
              loaded.vault.overlay,
              loaded.vault.savedValues,
            );
            return liveResolve.resolved.sections.find(
              (s) => s.sectionKey === section.sectionKey,
            ) ?? section;
          })()
        : section;

      content = (
        <>
          {packEditorEnabled && !isSectionEditing && (
            <div className="section-editor-bar">
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={() => handleEnterSectionEdit(section.sectionKey)}
              >
                Edit this form
              </button>
            </div>
          )}
          {isSectionEditing && (
            <div className="section-editor-bar">
              <div className="section-editor-bar__title-row">
                <label className="section-editor-bar__label" htmlFor="section-title-edit">
                  Section title
                </label>
                <input
                  id="section-title-edit"
                  className="section-editor-bar__input"
                  type="text"
                  value={workingPack?.sections.find((s) => s.sectionKey === section.sectionKey)?.title ?? section.title}
                  onChange={(e) => handleEditSectionTitle(section.sectionKey, e.target.value)}
                  aria-label="Section title"
                />
              </div>
              <div className="section-editor-bar__lede-row">
                <label className="section-editor-bar__label" htmlFor="section-lede-edit">
                  Section description
                </label>
                <textarea
                  id="section-lede-edit"
                  className="section-editor-bar__input"
                  value={workingPack?.sections.find((s) => s.sectionKey === section.sectionKey)?.lede ?? section.lede}
                  onChange={(e) => handleEditSectionLede(section.sectionKey, e.target.value)}
                  aria-label="Section description"
                  placeholder="A short intro shown under the section title"
                />
              </div>
              <div className="section-editor-bar__cardinality-row">
                {(() => {
                  const workingSection = workingPack?.sections.find(
                    (s) => s.sectionKey === section.sectionKey,
                  );
                  const isMulti = workingSection?.multiRecord ?? section.multiRecord;
                  const entryLabel = workingSection?.groups[0]?.title ?? "";
                  return (
                    <>
                      <label className="section-editor-bar__checkbox">
                        <input
                          type="checkbox"
                          checked={isMulti}
                          onChange={(e) =>
                            handleToggleMultiRecord(section.sectionKey, e.target.checked)
                          }
                          aria-label="Allow multiple entries"
                        />
                        <span>Allow multiple entries (add items individually)</span>
                      </label>
                      {isMulti && (
                        <div className="section-editor-bar__entry-name-row">
                          <label
                            className="section-editor-bar__label"
                            htmlFor="section-entry-name-edit"
                          >
                            Entry name
                          </label>
                          <input
                            id="section-entry-name-edit"
                            className="section-editor-bar__input"
                            type="text"
                            value={entryLabel}
                            onChange={(e) =>
                              handleEditEntryLabel(section.sectionKey, e.target.value)
                            }
                            aria-label="Entry name"
                            placeholder="e.g. Subscription — used on the “Add …” button"
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="section-editor-bar__actions">
                <button
                  className="button button--primary button--small"
                  type="button"
                  onClick={() => void handleSaveFormChanges()}
                >
                  Save form changes
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={handleCancelSectionEdit}
                >
                  Done editing
                </button>
              </div>
              {packEditError && (
                <p className="section-editor-bar__error" role="alert">
                  {packEditError}
                </p>
              )}
            </div>
          )}
          <SectionPage
            conflict={conflictSection === section.sectionKey}
            dirty={section.sectionKey in workingValues}
            draftBanner={
              draftRestore && draftRestore.sectionKey === section.sectionKey
                ? { stashedAt: draftRestore.stashedAt, stale: draftRestore.stale }
                : null
            }
            meta={loaded.vault.sectionMeta[section.sectionKey] ?? {}}
            saving={saving}
            schemaVersion={loaded.schemaVersion}
            section={displaySection}
            status={statusFor(section)}
            validationIssues={validationIssues}
            values={sectionWorkingValues(section.sectionKey)}
            onChange={(values) => handleSectionChange(section.sectionKey, values)}
            onDiscardConflict={() => void handleDiscardConflict(section.sectionKey)}
            onDiscardDraft={handleDiscardDraft}
            onMarkReviewed={() => void handleMarkReviewed(section.sectionKey)}
            onSave={() => void handleSaveSection(section.sectionKey)}
            onSaveAgain={() => void handleSaveAgain(section.sectionKey)}
            onSetNa={(na) => void handleSetNa(section.sectionKey, na)}
            editing={isSectionEditing}
            packSection={packSectionForEdit}
            onEditField={(sk, gk, field) => handleEditField(sk, gk, field)}
            onRemoveField={(sk, gk, key) => handleRemoveField(sk, gk, key)}
            onDuplicateField={(sk, gk, key) => handleDuplicateField(sk, gk, key)}
            onReorderField={(sk, gk, from, to) => handleReorderField(sk, gk, from, to)}
            onAddField={(sk, gk, type) => handleAddField(sk, gk, type)}
          />
        </>
      );
    }
  } else if (route.kind === "recovery-kit") {
    content = (
      <RecoveryKitPage
        sections={loaded.sections}
        values={loaded.vault.savedValues}
        sectionMeta={loaded.vault.sectionMeta}
        profile={loaded.vault.profile}
        kitMeta={loaded.vault.kitMeta}
        saving={saving}
        onSaveKit={(nextKitMeta) => void handleSaveKit(nextKitMeta)}
      />
    );
  } else if (route.kind === "backup") {
    content = <BackupPage />;
  }

  if (!content) {
    const greeting = loaded.vault.profile.ownerName
      ? `Welcome, ${loaded.vault.profile.ownerName}`
      : "Welcome";
    const firstIncomplete = summary.firstIncomplete;
    content = (
      <article className="welcome">
        <h1 className="welcome__title">{greeting}</h1>
        <p className="welcome__lede">
          This vault walks you through the handful of things your family
          would actually need — who to call, where things live, how to get
          in. A little at a time is plenty; every section you finish can save
          them weeks of chaos.
        </p>
        <div className="welcome__readiness">
          <span className="welcome__percent">{summary.percent}%</span>
          <span className="welcome__percent-label">
            {summary.percent === 0
              ? "ready — and that's exactly where everyone starts"
              : `ready — ${summary.readySections} of ${summary.totalSections} sections covered`}
          </span>
        </div>
        {firstIncomplete ? (
          <button
            className="button button--primary welcome__cta"
            type="button"
            onClick={() => openSection(firstIncomplete.sectionKey)}
          >
            Start with {firstIncomplete.title}
          </button>
        ) : (
          <p className="welcome__done">
            Every section is covered. Come back when something changes — the
            checklist will let you know when a review is due.
          </p>
        )}
      </article>
    );
  }

  return (
    <AppShell sidebar={sidebar}>
      <div className="main-pane">
        {banners}
        {content}
      </div>
      {pendingModeSwitch ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm form detail change">
          <div className="modal__body">
            <p>
              {pendingModeSwitch === "credential"
                ? "Switch to storing actual passwords and PINs in this vault?"
                : "Switch back to storing locations only?"}
            </p>
            {loaded.vault.customPack ? (
              <p className="modal__warning">
                Your custom form edits will be replaced by the standard form. Your entered data is kept.
              </p>
            ) : null}
            <div className="modal__actions">
              <button
                className="button button--primary"
                type="button"
                onClick={() => void handleSwitchMode(pendingModeSwitch)}
              >
                Confirm
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setPendingModeSwitch(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
