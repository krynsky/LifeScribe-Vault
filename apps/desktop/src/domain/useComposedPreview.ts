import { useMemo } from "react";
import { composePack } from "./composePack";
import type { FormPack, PackSection } from "./formModel";

export interface ComposedPreview {
  /** Composed sections in ascending order; empty when base is null or on error. */
  sections: PackSection[];
  /** Non-empty when composePack rejected the combination; empty otherwise. */
  error: string;
}

/**
 * Compose `base` with `selections` for preview + validity-guard purposes.
 * A combination composePack rejects (e.g. an addFields target a removal
 * deleted) surfaces as `error`, never a thrown render.
 */
export function useComposedPreview(
  base: FormPack | null,
  selections: Record<string, string>,
): ComposedPreview {
  return useMemo(() => {
    if (!base) return { sections: [], error: "" };
    try {
      const composed = composePack(base, base.modules ?? [], selections);
      const sections = [...composed.sections].sort((a, b) => a.order - b.order);
      return { sections, error: "" };
    } catch (caught) {
      return { sections: [], error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [base, selections]);
}
