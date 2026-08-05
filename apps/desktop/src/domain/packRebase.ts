import type { FormPack } from "./formModel";

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function itemKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["sectionKey", "groupKey", "systemKey", "value", "fromVersion"] as const) {
    if (typeof record[key] === "string" || typeof record[key] === "number") {
      return `${key}:${String(record[key])}`;
    }
  }
  return null;
}

function mergeValue(oldBase: unknown, custom: unknown, newBase: unknown): unknown {
  if (equal(custom, oldBase)) return structuredClone(newBase);
  if (equal(newBase, oldBase)) return structuredClone(custom);

  if (Array.isArray(oldBase) && Array.isArray(custom) && Array.isArray(newBase)) {
    const keyed = [...oldBase, ...custom, ...newBase].every((item) => itemKey(item) !== null);
    if (!keyed) return structuredClone(custom);
    const oldMap = new Map(oldBase.map((item) => [itemKey(item)!, item]));
    const customMap = new Map(custom.map((item) => [itemKey(item)!, item]));
    const newMap = new Map(newBase.map((item) => [itemKey(item)!, item]));
    const order = [
      ...custom.map((item) => itemKey(item)!),
      ...newBase.map((item) => itemKey(item)!).filter((key) => !customMap.has(key)),
    ];
    return order.flatMap((key) => {
      const oldItem = oldMap.get(key);
      const customItem = customMap.get(key);
      const newItem = newMap.get(key);
      if (oldItem !== undefined && customItem === undefined) return [];
      if (customItem === undefined) return newItem === undefined ? [] : [structuredClone(newItem)];
      if (newItem === undefined) {
        return oldItem !== undefined && equal(customItem, oldItem)
          ? []
          : [structuredClone(customItem)];
      }
      return [mergeValue(oldItem, customItem, newItem)];
    });
  }

  const oldRecord = typeof oldBase === "object" && oldBase !== null && !Array.isArray(oldBase)
    ? oldBase as Record<string, unknown>
    : null;
  const customRecord = typeof custom === "object" && custom !== null && !Array.isArray(custom)
    ? custom as Record<string, unknown>
    : null;
  const newRecord = typeof newBase === "object" && newBase !== null && !Array.isArray(newBase)
    ? newBase as Record<string, unknown>
    : null;
  if (!oldRecord || !customRecord || !newRecord) return structuredClone(custom);

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(oldRecord), ...Object.keys(customRecord), ...Object.keys(newRecord)]);
  for (const key of keys) {
    const wasPresent = Object.prototype.hasOwnProperty.call(oldRecord, key);
    const customizedPresent = Object.prototype.hasOwnProperty.call(customRecord, key);
    const newPresent = Object.prototype.hasOwnProperty.call(newRecord, key);
    if (wasPresent && !customizedPresent) continue;
    if (!customizedPresent) {
      if (newPresent) result[key] = structuredClone(newRecord[key]);
      continue;
    }
    if (!newPresent) {
      if (!wasPresent || !equal(customRecord[key], oldRecord[key])) {
        result[key] = structuredClone(customRecord[key]);
      }
      continue;
    }
    result[key] = mergeValue(oldRecord[key], customRecord[key], newRecord[key]);
  }
  return result;
}

/** Three-way stable-ID rebase: user deltas win; untouched base content updates. */
export function rebaseCustomPack(oldBase: FormPack, custom: FormPack, newBase: FormPack): FormPack {
  if (oldBase.packId !== custom.packId || oldBase.packId !== newBase.packId) {
    throw new Error("The saved custom form belongs to a different base pack.");
  }
  const rebased = mergeValue(oldBase, custom, newBase) as FormPack;
  rebased.schemaVersion = Math.max(custom.schemaVersion, newBase.schemaVersion);
  const oldSteps = new Map(oldBase.migrations.map((step) => [step.fromVersion, step]));
  const customSteps = new Map(custom.migrations.map((step) => [step.fromVersion, step]));
  const newSteps = new Map(newBase.migrations.map((step) => [step.fromVersion, step]));
  rebased.migrations = rebased.migrations.map((step) => {
    const oldStep = oldSteps.get(step.fromVersion);
    const customStep = customSteps.get(step.fromVersion);
    const newStep = newSteps.get(step.fromVersion);
    if (!customStep || !newStep || equal(customStep, oldStep) || equal(newStep, oldStep)) return step;
    const seen = new Set<string>();
    const operations = [...customStep.operations, ...newStep.operations].filter((operation) => {
      const signature = JSON.stringify(operation);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    return { ...step, operations };
  });
  return rebased;
}
