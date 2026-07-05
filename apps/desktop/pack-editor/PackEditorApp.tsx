import { useEffect, useMemo, useState } from "react";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import {
  addOptionalField,
  removeField,
  updateField,
} from "../src/creator/packEdits";
import type { FieldType, FormPack } from "../src/domain/formModel";
import { validatePack } from "../src/domain/packValidation";
import { deriveOverlay } from "../scripts/lib/derive-overlay.mjs";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { FieldList } from "./FieldList";
import { FieldPropertyPanel } from "./FieldPropertyPanel";
import { duplicateField, reorderFields } from "./fieldOps";
import { getPack, savePack, type PackName } from "./api";

type Status = "loading" | "ready" | "error";

function hintSystemKeys(pack: FormPack): Set<string> {
  const keys = new Set<string>();
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) keys.add(field.systemKey);
    }
  }
  return keys;
}

export function PackEditorApp() {
  const [packName, setPackName] = useState<PackName>("credential");
  const [status, setStatus] = useState<Status>("loading");
  const [hintPack, setHintPack] = useState<FormPack | null>(null);
  const [pack, setPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"design" | "preview" | "json">("design");
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");

  useEffect(() => {
    let current = true;
    setStatus("loading");
    setSelectedKey(null);
    setSaveMessage("");
    setSaveError("");
    getPack(packName)
      .then(({ hintPack: hint, overlay }) => {
        if (!current) return;
        const editablePack: FormPack =
          packName === "hint" ? hint : (buildCredentialPack(hint, overlay!) as FormPack);
        setHintPack(hint);
        setPack(editablePack);
        setActiveSection(editablePack.sections[0]?.sectionKey ?? "");
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
  }, [packName]);

  const hintKeys = useMemo(
    () => (packName === "credential" && hintPack ? hintSystemKeys(hintPack) : new Set<string>()),
    [hintPack, packName],
  );

  if (status === "loading") {
    return <main className="centered-screen">Loading the credential form…</main>;
  }
  if (status === "error" || !pack || !hintPack) {
    return (
      <main className="centered-screen">
        <p className="form-error" role="alert">
          {loadError || "The credential form could not be loaded."}
        </p>
      </main>
    );
  }

  const section = pack.sections.find((s) => s.sectionKey === activeSection);
  const selectedField =
    section?.groups.flatMap((g) => g.fields).find((f) => f.systemKey === selectedKey) ?? null;
  const selectedGroupKey =
    section?.groups.find((g) => g.fields.some((f) => f.systemKey === selectedKey))?.groupKey ?? null;
  const resolvedSection = section
    ? mergePackWithOverlay(pack, null, {}).resolved.sections.find(
        (s) => s.sectionKey === activeSection,
      )
    : undefined;
  const overlayJson =
    packName === "hint"
      ? JSON.stringify(pack, null, 2)
      : JSON.stringify(deriveOverlay(hintPack, pack), null, 2);

  async function handleSave() {
    if (!pack) return;
    const result = validatePack(pack);
    if (!result.ok) {
      setSaveError(`Cannot save: ${result.errors.join("; ")}`);
      setSaveMessage("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      await savePack(pack, packName);
      const { hintPack: hint, overlay } = await getPack(packName);
      setHintPack(hint);
      setPack(packName === "hint" ? hint : (buildCredentialPack(hint, overlay!) as FormPack));
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pack-editor">
      <nav className="pack-editor__pack-selector" aria-label="Pack">
        <button
          type="button"
          aria-current={packName === "credential" ? "page" : undefined}
          onClick={() => setPackName("credential")}
        >
          Credential Pack
        </button>
        <button
          type="button"
          aria-current={packName === "hint" ? "page" : undefined}
          onClick={() => setPackName("hint")}
        >
          Hint Pack
        </button>
      </nav>
      <nav className="pack-editor__nav" aria-label="Sections">
        {pack.sections.map((s) => (
          <button
            key={s.sectionKey}
            type="button"
            aria-current={s.sectionKey === activeSection ? "page" : undefined}
            onClick={() => {
              setActiveSection(s.sectionKey);
              setSelectedKey(null);
            }}
          >
            {s.title}
          </button>
        ))}
      </nav>

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

        {activeTab === "design" && section ? (
          <div className="pack-editor__design" role="tabpanel">
            <FieldList
              groups={section.groups}
              selectedKey={selectedKey}
              hintKeys={hintKeys}
              onSelect={setSelectedKey}
              onDuplicate={(gk, key) => setPack((p) => (p ? duplicateField(p, section.sectionKey, gk, key) : p))}
              onDelete={(gk, key) => {
                setPack((p) => (p ? removeField(p, section.sectionKey, gk, key) : p));
                setSelectedKey((cur) => (cur === key ? null : cur));
              }}
              onReorder={(gk, from, to) =>
                setPack((p) => (p ? reorderFields(p, section.sectionKey, gk, from, to) : p))
              }
              onAdd={(gk, type: FieldType) =>
                setPack((p) => (p ? addOptionalField(p, section.sectionKey, gk, type) : p))
              }
            />
            <FieldPropertyPanel
              field={selectedField}
              onChange={(updated) => {
                if (!selectedGroupKey) return;
                setPack((p) =>
                  p ? updateField(p, section.sectionKey, selectedGroupKey, updated.systemKey, () => updated) : p,
                );
              }}
            />
          </div>
        ) : null}

        {activeTab === "preview" && resolvedSection ? (
          <div className="pack-editor__preview" role="tabpanel">
            <FormRenderer
              section={resolvedSection}
              values={createSectionValues(resolvedSection.sectionKey)}
              schemaVersion={pack.schemaVersion}
              onChange={() => {}}
            />
          </div>
        ) : null}

        {activeTab === "json" ? (
          <pre className="pack-editor__json" role="tabpanel">
            {overlayJson}
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
