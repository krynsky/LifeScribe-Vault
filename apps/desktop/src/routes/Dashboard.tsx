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
  discardDraft,
  loadVaultSnapshot,
  lockVault,
  saveVaultSnapshot,
  stashDraft,
  sweepOrphanedAttachments,
  takeDraft,
  type VaultSnapshot,
} from "../api/vaultApi";
import { AppShell } from "../components/AppShell";
import { StatusBadge } from "../components/StatusBadge";
import { buildDraftPayload, parseDraftPayload } from "../domain/draft";
import type { FormPack, MergeNotice, ResolvedSection, UserOverlay } from "../domain/formModel";
import { loadDefaultPack } from "../domain/loadDefaultPack";
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
  type KitMeta,
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
import { ImportPage } from "./ImportPage";
import { RecoveryKitPage } from "./RecoveryKitPage";
import { SectionPage, type DraftBannerState } from "./SectionPage";
import { ACTIVITY_EVENTS, INACTIVITY_LOCK_MS } from "./lockPolicy";

export interface DashboardProps {
  /** Owner name from the setup flow, used until the first snapshot exists. */
  ownerNameHint?: string;
  /** Called once the vault is locked (auto or manual). */
  onLocked: () => void;
}

type Route =
  | { kind: "welcome" }
  | { kind: "section"; sectionKey: string }
  | { kind: "recovery-kit" }
  | { kind: "backup" }
  | { kind: "import" };

interface VaultState {
  generation: number;
  recovered: boolean;
  profile: VaultProfile;
  sectionMeta: SectionMetaMap;
  savedValues: VaultValues;
  overlay: UserOverlay | null;
  kitMeta: KitMeta | null;
  extra: Record<string, unknown>;
}

interface LoadedVault {
  sections: ResolvedSection[];
  notices: MergeNotice[];
  schemaVersion: number;
  vault: VaultState;
}

interface DraftRestoreState extends DraftBannerState {
  sectionKey: string;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The full load pipeline: normalize -> merge pack+overlay -> re-key renamed
 * custom fields -> migrate-on-read (in memory only) -> reconcile records
 * against the resolved definition. Pure; persists nothing.
 */
function buildLoadedVault(
  pack: FormPack,
  raw: VaultSnapshot | null,
  generation: number,
  recovered: boolean,
  ownerNameHint: string,
): LoadedVault | { blocked: string } {
  const parsed = normalizeSnapshot(raw, ownerNameHint);
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
    vault: {
      generation,
      recovered,
      profile: parsed.profile,
      sectionMeta: parsed.sectionMeta,
      savedValues: reconciled,
      overlay: merge.overlay.sections.length > 0 ? merge.overlay : null,
      kitMeta: parsed.kitMeta,
      extra: parsed.extra,
    },
  };
}

function collectAttachmentIds(values: VaultValues): string[] {
  const ids: string[] = [];
  for (const sectionValues of Object.values(values)) {
    for (const record of sectionValues.records) {
      for (const att of record.attachments ?? []) {
        ids.push(att.id);
      }
    }
  }
  return ids;
}

export function Dashboard({ ownerNameHint = "", onLocked }: DashboardProps) {
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
      let pack: FormPack;
      try {
        pack = await loadDefaultPack();
      } catch {
        if (isCurrent) {
          setPhase("error");
        }
        return;
      }

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
          if (isCurrent) {
            setPhase("error");
          }
          return;
        }
        // Fresh vault: no snapshot saved yet; base generation stays 0.
      }

      const result = buildLoadedVault(pack, raw, generation, recovered, ownerNameHint);
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

      // Orphan sweep: remove ciphertext files no longer referenced by any
      // snapshot record. Runs once here — after unlock + load — never while
      // locked (the reference set doesn't exist while locked).
      const allAttachmentIds = collectAttachmentIds(result.vault.savedValues);
      void sweepOrphanedAttachments(allAttachmentIds).catch(() => undefined);

      // Restore a stashed draft (corrupt stashes surface, never vanish).
      try {
        const taken = await takeDraft();
        if (!isCurrent) {
          return;
        }
        if (taken.corrupt) {
          setCorruptDraftNotice(true);
          // Surfaced this session; discard so it does not re-surface forever.
          void discardDraft().catch(() => undefined);
          return;
        }
        if (taken.draft) {
          const parsedDraft = parseDraftPayload(taken.draft);
          const known = parsedDraft.sections.filter((entry) =>
            result.sections.some((section) => section.sectionKey === entry.sectionKey),
          );
          if (known.length > 0) {
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
    }

    void load();
    return () => {
      isCurrent = false;
    };
  }, [ownerNameHint]);

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
      const pack = await loadDefaultPack();
      const result = buildLoadedVault(
        pack,
        response.snapshot,
        response.generation,
        response.recovered,
        ownerNameHint,
      );
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
      const pack = await loadDefaultPack();
      const result = buildLoadedVault(
        pack,
        response.snapshot,
        response.generation,
        response.recovered,
        ownerNameHint,
      );
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
          <li>
            <button
              aria-current={route.kind === "import" ? "page" : undefined}
              className={
                route.kind === "import"
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              type="button"
              onClick={() => setRoute({ kind: "import" })}
            >
              <span className="sidebar__item-title">Import from v1</span>
            </button>
          </li>
        </ul>
      </nav>

      <button
        className="button button--secondary sidebar__lock"
        disabled={locking}
        type="button"
        onClick={() => void performLock()}
      >
        {locking ? "Locking…" : "Lock vault"}
      </button>
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
      content = (
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
          section={section}
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
        />
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
  } else if (route.kind === "import") {
    content = (
      <ImportPage
        savedValues={loaded.vault.savedValues}
        saving={saving}
        onSave={(nextValues) =>
          persist(loaded, nextValues, loaded.vault.sectionMeta, null).then(() => undefined)
        }
        onCancel={() => setRoute({ kind: "welcome" })}
      />
    );
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
    </AppShell>
  );
}
