/**
 * Pure inverse of buildCredentialPack: hint pack + edited credential pack ->
 * overlay, such that buildCredentialPack(hint, deriveOverlay(hint, cred))
 * deep-equals cred. DEV/ADMIN TOOLING — not imported by the app runtime.
 *
 * The generator inserts added fields at order-0.5 and renumbers touched groups
 * to sequential integers, so a group's final positions are distinct integers.
 * This lets us reproduce ordering exactly:
 *   - added fields carry their final 1-based position;
 *   - shared fields get an explicit order override ONLY when the user reordered
 *     them relative to the hint sequence (a mechanical shift from insertion is
 *     reproduced by the generator with no override).
 */

const FIELD_PROPS = [
  "label",
  "helperText",
  "type",
  "required",
  "protected",
  "options",
  "visibleWhen",
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function indexHint(hintPack) {
  const bySection = new Map();
  for (const section of hintPack.sections) {
    const groups = new Map();
    for (const group of section.groups) {
      groups.set(group.groupKey, group);
    }
    bySection.set(section.sectionKey, { section, groups });
  }
  return bySection;
}

export function deriveOverlay(hintPack, credentialPack) {
  const hintIndex = indexHint(hintPack);
  const fieldOverrides = {};
  const addedFields = [];
  const kitAdditions = {};

  for (const credSection of credentialPack.sections) {
    const hintSection = hintIndex.get(credSection.sectionKey);

    for (const credGroup of credSection.groups) {
      const hintGroup = hintSection?.groups.get(credGroup.groupKey);
      const hintFieldByKey = new Map(
        (hintGroup?.fields ?? []).map((f) => [f.systemKey, f]),
      );

      const credSorted = [...credGroup.fields].sort((a, b) => a.order - b.order);
      const credShared = credSorted
        .filter((f) => hintFieldByKey.has(f.systemKey))
        .map((f) => f.systemKey);
      const hintShared = [...(hintGroup?.fields ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((f) => f.systemKey);
      const reordered = JSON.stringify(credShared) !== JSON.stringify(hintShared);

      // Gap-relative position for added fields: the generator inserts each added
      // field at `order - 0.5`, i.e. into the gap right after `order - 1` hint
      // fields. Absolute index breaks when two added fields share one gap (a hint
      // field that follows both would sit between their `.5` slots on rebuild), so
      // an added field's stored order is the count of shared fields preceding it,
      // plus one — consecutive added fields in the same gap share that order and
      // reproduce their edited sequence exactly.
      let precedingShared = 0;

      credSorted.forEach((field, index) => {
        const finalPosition = index + 1;
        const hintField = hintFieldByKey.get(field.systemKey);

        if (!hintField) {
          const { order: _order, ...rest } = field;
          addedFields.push({
            sectionKey: credSection.sectionKey,
            groupKey: credGroup.groupKey,
            order: precedingShared + 1,
            field: rest,
          });
          return;
        }

        precedingShared += 1;

        const override = {};
        for (const prop of FIELD_PROPS) {
          if (!deepEqual(hintField[prop], field[prop])) {
            override[prop] = field[prop];
          }
        }
        if (reordered) {
          override.order = finalPosition;
        }
        if (Object.keys(override).length > 0) {
          fieldOverrides[field.systemKey] = override;
        }
      });
    }

    const hintKit = new Set(
      (hintSection?.section.kitMapping?.entries ?? []).flatMap((e) => e.fields),
    );
    const added = (credSection.kitMapping?.entries ?? [])
      .flatMap((e) => e.fields)
      .filter((key) => !hintKit.has(key));
    if (added.length > 0) {
      kitAdditions[credSection.sectionKey] = added;
    }
  }

  return {
    packId: credentialPack.packId,
    fieldOverrides,
    addedFields,
    kitAdditions,
  };
}
