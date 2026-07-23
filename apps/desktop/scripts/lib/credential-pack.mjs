/**
 * Pure transform: hint FormPack + credential overlay -> credential FormPack.
 *
 * DEV/ADMIN BUILD TOOLING — this is NOT imported by the app runtime. The only
 * shipped artifact is the generated resources/packs/default-pack-credential.json.
 * The CLI wrapper lives in scripts/build-credential-pack.mjs; a drift-guard test
 * in src/domain/credentialPack.test.ts asserts the committed pack equals this
 * transform's output.
 *
 * The credential pack is, by the superset invariant, exactly the hint pack plus
 * a credential layer: field label/helper overrides, added secret fields, and
 * kit-mapping additions. Encoding that as an overlay keeps the two packs in
 * lockstep — a shared field edited in the hint pack flows through automatically,
 * and the superset invariant cannot be broken by hand.
 */

function findGroup(pack, sectionKey, groupKey) {
  const section = pack.sections.find((s) => s.sectionKey === sectionKey);
  if (!section) {
    throw new Error(`overlay references unknown section "${sectionKey}"`);
  }
  const group = section.groups.find((g) => g.groupKey === groupKey);
  if (!group) {
    throw new Error(`overlay references unknown group "${sectionKey}/${groupKey}"`);
  }
  return group;
}

/** Merge per-field label/helper/order overrides onto the shared hint fields. */
function applyFieldOverrides(pack, fieldOverrides, touched) {
  const remaining = new Set(Object.keys(fieldOverrides ?? {}));
  for (const section of pack.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        const override = fieldOverrides?.[field.systemKey];
        if (override) {
          Object.assign(field, override);
          remaining.delete(field.systemKey);
          if (override.order !== undefined) {
            touched.add(group);
          }
        }
      }
    }
  }
  if (remaining.size > 0) {
    throw new Error(
      `overlay fieldOverrides reference unknown systemKeys: ${[...remaining].join(", ")}`,
    );
  }
}

/**
 * Insert the credential-only secret fields. `order` is the desired FINAL slot;
 * we sort the new field just ahead of whatever currently holds that slot, then
 * renumber the group to sequential integers.
 */
function applyAddedFields(pack, addedFields, touched) {
  for (const add of addedFields ?? []) {
    const group = findGroup(pack, add.sectionKey, add.groupKey);
    if (group.fields.some((f) => f.systemKey === add.field.systemKey)) {
      throw new Error(`added field "${add.field.systemKey}" already exists in ${add.sectionKey}/${add.groupKey}`);
    }
    group.fields.push({ ...add.field, order: add.order - 0.5 });
    touched.add(group);
  }
}

function renumberTouchedGroups(touched) {
  for (const group of touched) {
    group.fields.sort((a, b) => a.order - b.order);
    group.fields.forEach((field, index) => {
      field.order = index + 1;
    });
  }
}

/** Append secret systemKeys to a section's first kit-mapping entry. */
function applyKitAdditions(pack, kitAdditions) {
  for (const [sectionKey, systemKeys] of Object.entries(kitAdditions ?? {})) {
    const section = pack.sections.find((s) => s.sectionKey === sectionKey);
    if (!section) {
      throw new Error(`kitAdditions references unknown section "${sectionKey}"`);
    }
    const entry = section.kitMapping?.entries?.[0];
    if (!entry) {
      throw new Error(`section "${sectionKey}" has no kitMapping entry to extend`);
    }
    for (const key of systemKeys) {
      if (!entry.fields.includes(key)) {
        entry.fields.push(key);
      }
    }
  }
}

export function buildCredentialPack(hintPack, overlay) {
  const pack = structuredClone(hintPack);
  if (overlay.packId) {
    pack.packId = overlay.packId;
  }

  const touched = new Set();
  applyFieldOverrides(pack, overlay.fieldOverrides, touched);
  applyAddedFields(pack, overlay.addedFields, touched);
  renumberTouchedGroups(touched);
  applyKitAdditions(pack, overlay.kitAdditions);
  // The credential pack is a fully-composed variant artifact — it carries no
  // module definitions (composable modules live only on the base pack and are
  // composed at load). Strip any that came along in the hint-pack clone.
  delete pack.modules;
  return pack;
}

/** Serialize a pack the way the resource file is stored (2-space, trailing LF). */
export function serializePack(pack) {
  return `${JSON.stringify(pack, null, 2)}\n`;
}
