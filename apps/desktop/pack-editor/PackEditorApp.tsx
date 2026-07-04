import { useEffect, useMemo, useState } from "react";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import {
  addOptionalField,
  moveField,
  removeField,
  updateField,
  updateGroup,
} from "../src/creator/packEdits";
import type { FormPack } from "../src/domain/formModel";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { validatePack } from "../src/domain/packValidation";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { getPack, savePack } from "./api";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [hintPack, setHintPack] = useState<FormPack | null>(null);
  const [pack, setPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");

  useEffect(() => {
    let current = true;
    getPack()
      .then(({ hintPack: hint, overlay }) => {
        if (!current) return;
        const credential = buildCredentialPack(hint, overlay) as FormPack;
        setHintPack(hint);
        setPack(credential);
        setActiveSection(credential.sections[0]?.sectionKey ?? "");
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

  const resolvedSections = useMemo(
    () => (pack ? mergePackWithOverlay(pack, null, {}).resolved.sections : []),
    [pack],
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

  const section = resolvedSections.find((s) => s.sectionKey === activeSection);
  const rawSection = pack.sections.find((s) => s.sectionKey === activeSection);

  // The overlay can only ADD fields, never remove one that exists in the hint
  // pack, so removing a shared hint field would silently reappear on reload.
  // Only added (non-hint) fields may be removed.
  function isHintField(systemKey: string): boolean {
    return (hintPack?.sections ?? []).some((s) =>
      s.groups.some((g) => g.fields.some((f) => f.systemKey === systemKey)),
    );
  }

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
      await savePack(pack);
      // Reload so the editor reflects the regenerated pack.
      const { hintPack: hint, overlay } = await getPack();
      setHintPack(hint);
      setPack(buildCredentialPack(hint, overlay) as FormPack);
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pack-editor">
      <nav className="pack-editor__nav" aria-label="Sections">
        {pack.sections.map((s) => (
          <button
            key={s.sectionKey}
            type="button"
            aria-current={s.sectionKey === activeSection ? "page" : undefined}
            onClick={() => setActiveSection(s.sectionKey)}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <main className="pack-editor__main">
        {section && rawSection ? (
          <>
            <section className="pack-editor__edit" aria-label="Edit">
              <h2>{section.title}</h2>
              <FormRenderer
                section={section}
                values={createSectionValues(section.sectionKey)}
                schemaVersion={pack.schemaVersion}
                onChange={() => {}}
                editing
                packSection={rawSection}
                onEditField={(sk, gk, updated) =>
                  setPack((p) =>
                    p ? updateField(p, sk, gk, updated.systemKey, () => updated) : p,
                  )
                }
                onRemoveField={(sk, gk, key) => {
                  if (isHintField(key)) {
                    setSaveError(
                      "Only added fields can be removed. Shared fields come from the safe form.",
                    );
                    return;
                  }
                  setPack((p) => (p ? removeField(p, sk, gk, key) : p));
                }}
                onMoveField={(sk, gk, key, dir) =>
                  setPack((p) => (p ? moveField(p, sk, gk, key, dir) : p))
                }
                onAddField={(sk, gk) =>
                  setPack((p) => (p ? addOptionalField(p, sk, gk) : p))
                }
                onEditGroupTitle={(sk, gk, title) =>
                  setPack((p) =>
                    p ? updateGroup(p, sk, gk, (g) => ({ ...g, title })) : p,
                  )
                }
              />
            </section>

            <section className="pack-editor__preview" aria-label="Preview">
              <h2>Preview</h2>
              <FormRenderer
                section={section}
                values={createSectionValues(section.sectionKey)}
                schemaVersion={pack.schemaVersion}
                onChange={() => {}}
              />
            </section>
          </>
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
