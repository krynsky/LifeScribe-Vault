import { useEffect, useState } from "react";
import {
  addModule,
  addModuleOption,
  removeModuleOption,
  setModuleDefaultOption,
  updateModuleDetails,
  updateModuleOptionLabel,
  type EditTarget,
} from "../src/creator/editorEdits";
import { buildEditorView } from "../src/creator/editorView";
import type { FormPack } from "../src/domain/formModel";
import { composePack } from "../src/domain/composePack";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { validatePack } from "../src/domain/packValidation";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { backupPacks, getPack, savePack } from "./api";
import { ModulePropertyPanel } from "./ModulePropertyPanel";
import { OverlayDesign } from "./OverlayDesign";
import { SectionNav } from "./SectionNav";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [base, setBase] = useState<FormPack | null>(null);
  const [viewSelections, setViewSelections] = useState<Record<string, string | null>>({});
  const [previewSelections, setPreviewSelections] = useState<Record<string, string>>({});
  const [activeTarget, setActiveTarget] = useState<EditTarget>({ kind: "base" });
  const [activeSection, setActiveSection] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
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
        setViewSelections({});
        setPreviewSelections({});
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
  // concrete option — its default when the creator hasn't picked one in the
  // Preview picker — which is exactly what composePack does at runtime. This
  // is a fully independent selection from the Design overlay (viewSelections):
  // changing one must never move the other, so each gets its own state.
  const resolvedPreviewSelections = Object.fromEntries(
    (base.modules ?? []).map((m) => [m.moduleId, previewSelections[m.moduleId] ?? m.defaultOptionId]),
  );
  // The preview picker can represent a module combination (e.g. an addFields
  // target section that isn't present after another module's addSections
  // removal) that composePack rejects outright. That must surface as a visible
  // message, not a silent blank pane — this branch has repeatedly hit that bug
  // class.
  let resolvedSection;
  let previewError = "";
  try {
    const composed = composePack(base, base.modules ?? [], resolvedPreviewSelections);
    resolvedSection = mergePackWithOverlay(composed, null, {}).resolved.sections.find(
      (s) => s.sectionKey === activeSection,
    );
  } catch (error) {
    resolvedSection = undefined;
    previewError = error instanceof Error ? error.message : String(error);
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
      await savePack(base);
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
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => {
                setEditingModuleId(module.moduleId);
                setActiveTab("design");
              }}
            >
              {`Edit ${module.title} details`}
            </button>
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
        <button
          type="button"
          className="button button--ghost button--small pack-editor__add-module"
          onClick={() => {
            const before = new Set((base.modules ?? []).map((m) => m.moduleId));
            const next = addModule(base);
            const created = (next.modules ?? []).find((m) => !before.has(m.moduleId));
            setBase(next);
            setEditingModuleId(created?.moduleId ?? null);
            setActiveTab("design");
          }}
        >
          + Create module
        </button>
      </nav>

      <SectionNav
        base={base}
        view={view}
        activeTarget={activeTarget}
        activeSection={activeSection}
        onSelectSection={(sectionKey) => {
          setActiveSection(sectionKey);
          setSelectedKey(null);
          setEditingModuleId(null);
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
            {editingModuleId && (base.modules ?? []).find((m) => m.moduleId === editingModuleId) ? (
              <ModulePropertyPanel
                module={(base.modules ?? []).find((m) => m.moduleId === editingModuleId)!}
                onChangeDetails={(patch) => setBase(updateModuleDetails(base, editingModuleId, patch))}
                onChangeOptionLabel={(optionId, label) =>
                  setBase(updateModuleOptionLabel(base, editingModuleId, optionId, label))
                }
                onSetDefaultOption={(optionId) =>
                  setBase(setModuleDefaultOption(base, editingModuleId, optionId))
                }
                onAddOption={() => setBase(addModuleOption(base, editingModuleId))}
                onRemoveOption={(optionId) => setBase(removeModuleOption(base, editingModuleId, optionId))}
                onClose={() => setEditingModuleId(null)}
              />
            ) : viewSection ? (
              <OverlayDesign
                base={base}
                view={view}
                viewSection={viewSection}
                activeTarget={activeTarget}
                selectedKey={selectedKey}
                onSelectKey={(key) => {
                  setSelectedKey(key);
                  setEditingModuleId(null);
                }}
                onChangeBase={setBase}
                onError={setSaveError}
              />
            ) : null}
          </div>
        ) : null}

        {activeTab === "preview" ? (
          <div className="pack-editor__preview" role="tabpanel">
            {(base.modules ?? []).length > 0 ? (
              <div className="pack-editor__preview-selectors">
                {(base.modules ?? []).map((module) => (
                  <label key={module.moduleId} className="pack-editor__preview-select">
                    <span>{`Preview selection for ${module.title}`}</span>
                    <select
                      aria-label={`Preview selection for ${module.title}`}
                      value={previewSelections[module.moduleId] ?? module.defaultOptionId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPreviewSelections((prev) => ({ ...prev, [module.moduleId]: value }));
                      }}
                    >
                      {module.options.map((option) => (
                        <option key={option.optionId} value={option.optionId}>
                          {option.label ?? option.optionId}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            {previewError ? (
              <p className="form-error" role="alert">
                {`Preview unavailable for this combination: ${previewError}`}
              </p>
            ) : resolvedSection ? (
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
