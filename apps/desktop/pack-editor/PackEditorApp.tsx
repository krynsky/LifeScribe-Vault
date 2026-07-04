import { useEffect, useMemo, useState } from "react";
import { buildCredentialPack } from "../scripts/lib/credential-pack.mjs";
import type { FormPack } from "../src/domain/formModel";
import { mergePackWithOverlay } from "../src/domain/packMerge";
import { createSectionValues } from "../src/domain/valuesStore";
import { FormRenderer } from "../src/forms/FormRenderer";
import { getPack } from "./api";

type Status = "loading" | "ready" | "error";

export function PackEditorApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [hintPack, setHintPack] = useState<FormPack | null>(null);
  const [pack, setPack] = useState<FormPack | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

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
          <section className="pack-editor__preview" aria-label="Preview">
            <h2>{section.title}</h2>
            <FormRenderer
              section={section}
              values={createSectionValues(section.sectionKey)}
              schemaVersion={pack.schemaVersion}
              onChange={() => {}}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
