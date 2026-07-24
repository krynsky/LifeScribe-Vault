import { useEffect, useState } from "react";
import type { EditTarget } from "../src/creator/editorEdits";
import { buildEditorView } from "../src/creator/editorView";
import type { FormPack } from "../src/domain/formModel";
import { composePack } from "../src/domain/composePack";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { validatePack } from "../src/domain/packValidation";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { backupPacks, getPack, savePack } from "./api";
import { OverlayDesign } from "./OverlayDesign";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [base, setBase] = useState<FormPack | null>(null);
  const [viewSelections, setViewSelections] = useState<Record<string, string | null>>({});
  const [activeTarget, setActiveTarget] = useState<EditTarget>({ kind: "base" });
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
    getPack()
      .then(({ pack }) => {
        if (!current) return;
        setBase(pack);
        setViewSelections({});
        setActiveTarget({ kind: "base" });
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

  const view = buildEditorView(base, viewSelections);
  const visibleSections = view.sections.filter((s) => !s.removed);
  const viewSection =
    visibleSections.find((s) => s.sectionKey === activeSection) ?? visibleSections[0];

  // Preview shows the true end-user composition: every module resolves to a
  // concrete option — its default when the creator hasn't overlaid one — which
  // is exactly what composePack does at runtime. This intentionally differs from
  // the Design overlay view, where "not overlaid" means "show none of this
  // module's changes". Task 6 gives Preview its own selection picker.
  const previewSelections = Object.fromEntries(
    (base.modules ?? []).map((m) => [m.moduleId, viewSelections[m.moduleId] ?? m.defaultOptionId]),
  );
  // The Design overlay view can represent module edits (e.g. an addFields target
  // section that isn't in the current view) that composePack rejects outright.
  // A bad composition must not crash Design/JSON — it only affects Preview.
  let resolvedSection;
  try {
    const composed = composePack(base, base.modules ?? [], previewSelections);
    resolvedSection = mergePackWithOverlay(composed, null, {}).resolved.sections.find(
      (s) => s.sectionKey === viewSection?.sectionKey,
    );
  } catch {
    resolvedSection = undefined;
  }

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
    if (!base) return;
    const result = validatePack(base);
    if (!result.ok) {
      setSaveError(`Cannot save: ${result.errors.join("; ")}`);
      setSaveMessage("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      await savePack(base, "hint");
      const { pack } = await getPack();
      setBase(pack);
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pack-editor">
      <nav className="pack-editor__modules" aria-label="Modules">
        <button
          type="button"
          aria-current={activeTarget.kind === "base" ? "true" : undefined}
          onClick={() => setActiveTarget({ kind: "base" })}
        >
          Base
        </button>
        {(base.modules ?? []).map((module) => (
          <div key={module.moduleId} className="pack-editor__module">
            <h3>{module.title}</h3>
            <label className="pack-editor__module-select">
              <span>{`View selection for ${module.title}`}</span>
              <select
                aria-label={`View selection for ${module.title}`}
                value={viewSelections[module.moduleId] ?? ""}
                onChange={(e) => {
                  const value = e.target.value || null;
                  setViewSelections((prev) => ({ ...prev, [module.moduleId]: value }));
                }}
              >
                <option value="">Not overlaid</option>
                {module.options.map((option) => (
                  <option key={option.optionId} value={option.optionId}>
                    {option.label ?? option.optionId}
                  </option>
                ))}
              </select>
            </label>
            <ul className="pack-editor__module-options">
              {module.options.map((option) => {
                const isActive =
                  activeTarget.kind === "module" &&
                  activeTarget.moduleId === module.moduleId &&
                  activeTarget.optionId === option.optionId;
                return (
                  <li key={option.optionId}>
                    <button
                      type="button"
                      aria-current={isActive ? "true" : undefined}
                      onClick={() =>
                        setActiveTarget({ kind: "module", moduleId: module.moduleId, optionId: option.optionId })
                      }
                    >
                      {`Edit ${option.label ?? option.optionId} layer`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <nav className="pack-editor__nav" aria-label="Sections">
        {visibleSections.map((s) => (
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

        {activeTab === "design" && viewSection ? (
          <div role="tabpanel">
            <OverlayDesign
              base={base}
              view={view}
              viewSection={viewSection}
              activeTarget={activeTarget}
              selectedKey={selectedKey}
              onSelectKey={setSelectedKey}
              onChangeBase={setBase}
              onError={setSaveError}
            />
          </div>
        ) : null}

        {activeTab === "preview" && resolvedSection ? (
          <div className="pack-editor__preview" role="tabpanel">
            <FormRenderer
              section={resolvedSection}
              values={createSectionValues(resolvedSection.sectionKey)}
              schemaVersion={base.schemaVersion}
              onChange={() => {}}
            />
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
