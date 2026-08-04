/**
 * Recovery Kit page (U7): regenerate-on-view.
 *
 * The Kit is derived from the current SAVED values on every render — the
 * page never stores Kit content. "Save Kit" only commits the staleness
 * anchor ({lastGeneratedAt, fingerprint}) to the snapshot via the normal
 * CAS save path; a stale banner appears whenever the saved fingerprint no
 * longer matches what the current data produces.
 *
 * Pointer-based: it contains only the credential-filtered, kit-mapped fields
 * and can be printed or exported as a PDF.
 */

import { useState } from "react";
import { save as saveFilePicker } from "@tauri-apps/plugin-dialog";
import { writePdfExport } from "../api/vaultApi";
import {
  buildRecoveryKit,
  computeKitFingerprint,
  isKitStale,
  type KitSourceSection,
} from "../domain/recoveryKit";
import { buildRecoveryKitPdf, recoveryKitPdfFilename } from "../domain/recoveryKitPdf";
import type { KitMeta, SectionMetaMap, VaultProfile } from "../domain/snapshot";
import type { VaultValues } from "../domain/valuesStore";

export interface RecoveryKitPageProps {
  /** Resolved (overlay-merged) sections; only their kit mappings are read. */
  sections: readonly KitSourceSection[];
  /** SAVED vault values — transient form edits never reach the Kit. */
  values: VaultValues;
  sectionMeta: SectionMetaMap;
  profile: Pick<VaultProfile, "ownerName">;
  /** Staleness anchor from the snapshot; null when never saved. */
  kitMeta: KitMeta | null;
  saving: boolean;
  onSaveKit: (nextKitMeta: KitMeta) => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function RecoveryKitPage({
  sections,
  values,
  sectionMeta,
  profile,
  kitMeta,
  saving,
  onSaveKit,
}: RecoveryKitPageProps) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfExportPath, setPdfExportPath] = useState("");
  const [pdfExportError, setPdfExportError] = useState("");
  const kit = buildRecoveryKit(sections, values, sectionMeta, profile);
  const currentFingerprint = computeKitFingerprint(sections, values, sectionMeta);
  const stale = isKitStale(currentFingerprint, kitMeta);

  async function handleExportPdf() {
    setPdfExportError("");
    setPdfExportPath("");

    try {
      const outputPath = await saveFilePicker({
        defaultPath: recoveryKitPdfFilename(kit),
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      });
      if (!outputPath) {
        return;
      }

      setExportingPdf(true);
      await writePdfExport(outputPath, buildRecoveryKitPdf(kit, new Date()));
      setPdfExportPath(outputPath);
    } catch {
      setPdfExportError("The PDF could not be saved. Choose another location and try again.");
    } finally {
      setExportingPdf(false);
    }
  }
  if (kit.entries.length === 0) {
    return (
      <article className="kit-page" aria-labelledby="kit-title">
        <header className="kit-page__header">
          <h1 className="kit-page__title" id="kit-title">
            Recovery Kit
          </h1>
          <p className="kit-page__intro">
            This is a snapshot of the data in your vault that you can print,
            store, and review.
          </p>
        </header>
        <p className="kit-page__empty">
          Your Recovery Kit will appear here once you complete at least one
          guided section.
        </p>
      </article>
    );
  }

  return (
    <article className="kit-page" aria-labelledby="kit-title">
      <header className="kit-page__header">
        <h1 className="kit-page__title" id="kit-title">
          Recovery Kit
        </h1>
        <p className="kit-page__updated">
          {kitMeta
            ? `Last updated ${formatTimestamp(kitMeta.lastGeneratedAt)}`
            : "Not saved yet"}
        </p>
        <p className="kit-page__intro">
          This is a snapshot of the data in your vault that you can print,
          store, and review.
        </p>
      </header>

      {stale ? (
        <div className="banner banner--warning" role="status">
          <p className="banner__text">
            Your vault data has changed since this Kit was last saved — this
            view reflects your latest data.
          </p>
        </div>
      ) : null}

      <div className="kit-page__toolbar">
        <button
          className="button button--primary"
          disabled={saving}
          type="button"
          onClick={() =>
            onSaveKit({
              lastGeneratedAt: new Date().toISOString(),
              fingerprint: currentFingerprint,
            })
          }
        >
          {saving ? "Saving…" : "Save Kit"}
        </button>
        <button className="button" type="button" onClick={() => window.print()}>
          Print
        </button>
        <button
          className="button"
          disabled={exportingPdf}
          type="button"
          onClick={() => void handleExportPdf()}
        >
          {exportingPdf ? "Exporting PDF..." : "Export PDF"}
        </button>
      </div>

      {pdfExportPath ? (
        <p className="kit-page__export-status" role="status">
          PDF saved to: {pdfExportPath}
        </p>
      ) : null}
      {pdfExportError ? (
        <p className="kit-page__export-error" role="alert">
          {pdfExportError}
        </p>
      ) : null}

      <div className="kit-page__document">
        {kit.entries.map((entry, entryIndex) => (
          <section
            className="kit-entry"
            key={`${entry.sectionKey}:${entryIndex}`}
            aria-label={entry.heading}
          >
            <p className="kit-entry__eyebrow">{entry.sectionTitle}</p>
            <h2 className="kit-entry__heading">{entry.heading}</h2>
            {entry.blocks.map((block) => (
              <div className="kit-block" key={block.recordId}>
                {block.recordLabel ? (
                  <h3 className="kit-block__label">{block.recordLabel}</h3>
                ) : null}
                <dl className="kit-block__items">
                  {block.items.map((item) => (
                    <div className="kit-item" key={item.systemKey}>
                      <dt className="kit-item__label">{item.label}</dt>
                      <dd className="kit-item__value">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
