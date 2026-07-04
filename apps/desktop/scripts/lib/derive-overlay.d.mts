export function deriveOverlay(
  hintPack: unknown,
  credentialPack: unknown,
): {
  packId: string;
  fieldOverrides: Record<string, Record<string, unknown>>;
  addedFields: Array<{
    sectionKey: string;
    groupKey: string;
    order: number;
    field: Record<string, unknown>;
  }>;
  kitAdditions: Record<string, string[]>;
};
