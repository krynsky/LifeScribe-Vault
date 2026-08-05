import { useEffect, useState } from "react";
import type { FormPack } from "../src/domain/formModel";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { validatePack } from "../src/domain/packValidation";
import { deriveAutoMigration } from "../src/creator/packAutoMigrate";
import { removeSection } from "../src/creator/packEdits";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { backupPacks, getPack, savePack } from "./api";
import { OverlayDesign } from "./OverlayDesign";
import { SectionNav } from "./SectionNav";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [base, setBase] = useState<FormPack | null>(null);
  const [previousPack, setPreviousPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"design" | "preview" | "json">("design");
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");

  useEffect(() => {
    // No setState calls here before the async call: status/selectedKey/
    // saveMessage/saveError already start at these exact values via
    // useState, and this effect has an empty dep array (runs once on
    // mount only), so re-asserting them here would just be a redundant
    // cascading render.
    let current = true;
    getPack()
      .then(({ pack }) => {
        if (!current) return;
        setBase(pack);
        setPreviousPack(structuredClone(pack));
        setActiveSection(pack.sections[0]?.sectionKey ?? "");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus("error");
      });
    return () => {
      current = false;
    };
  }, []);

  if (status === "loading") {
    return <main className="centered-screen">Loading the form pack…</main>;
  }
  if (status === "error" || !base) {
    return (
      <main className="centered-screen">
        <p className="form-error" role="alert">
          {loadError || "The form pack could not be loaded."}
        </p>
      </main>
    );
  }

  const sections = [...base.sections].sort((a, b) => a.order - b.order);
  const currentSection = sections.find((s) => s.sectionKey === activeSection) ?? sections[0];

  // Preview shows the end-user rendering of the same pack the Design tab edits.
  const resolvedSection = currentSection
    ? mergePackWithOverlay(base, null, {}).resolved.sections.find(
        (s) => s.sectionKey === currentSection.sectionKey,
      )
    : undefined;

  const jsonText = JSON.stringify(base, null, 2);

  async function handleBackup() {
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const dir = await backupPacks();
      setSaveMessage(`Backed up to ${dir}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!base || !previousPack) return;
    const result = validatePack(base);
    if (!result.ok) {
      setSaveError(`Cannot save: ${result.errors.join("; ")}`);
      setSaveMessage("");
      return;
    }
    const derived = deriveAutoMigration(previousPack, result.pack);
    if (!derived.ok) {
      setSaveError(`Cannot save: ${derived.error}`);
      setSaveMessage("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const savedPack = await savePack(base, previousPack);
      const pack = savedPack ?? (await getPack()).pack;
      setBase(pack);
      setPreviousPack(structuredClone(pack));
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pack-editor">
      <SectionNav
        base={base}
        activeSection={activeSection}
        onSelectSection={(sectionKey) => {
          setActiveSection(sectionKey);
          setSelectedKey(null);
        }}
        onChangeBase={setBase}
      />

      <main className="pack-editor__main">
        <div className="pack-editor__tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === "design"} onClick={() => setActiveTab("design")}>
            Design
          </button>
          <button role="tab" aria-selected={activeTab === "preview"} onClick={() => setActiveTab("preview")}>
            Preview
          </button>
          <button role="tab" aria-selected={activeTab === "json"} onClick={() => setActiveTab("json")}>
            JSON
          </button>
        </div>

        {activeTab === "design" ? (
          <div role="tabpanel">
            {currentSection ? (
              <OverlayDesign
                base={base}
                section={currentSection}
                selectedKey={selectedKey}
                onSelectKey={setSelectedKey}
                onChangeBase={setBase}
                onRemoveSection={(sectionKey) => {
                  const next = removeSection(base, sectionKey);
                  setBase(next);
                  const remaining = [...next.sections].sort((a, b) => a.order - b.order);
                  setActiveSection(remaining[0]?.sectionKey ?? "");
                  setSelectedKey(null);
                }}
                onError={setSaveError}
              />
            ) : null}
          </div>
        ) : null}

        {activeTab === "preview" ? (
          <div className="pack-editor__preview" role="tabpanel">
            {resolvedSection ? (
              <FormRenderer
                section={resolvedSection}
                values={createSectionValues(resolvedSection.sectionKey)}
                schemaVersion={base.schemaVersion}
                onChange={() => {}}
              />
            ) : null}
          </div>
        ) : null}

        {activeTab === "json" ? (
          <pre className="pack-editor__json" role="tabpanel">
            {jsonText}
          </pre>
        ) : null}

        <div className="pack-editor__savebar">
          <button
            className="button button--primary"
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="button button--secondary"
            type="button"
            disabled={saving}
            onClick={() => void handleBackup()}
          >
            Back up packs
          </button>
          {saveMessage ? <span>{saveMessage}</span> : null}
          {saveError ? (
            <span className="form-error" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}
