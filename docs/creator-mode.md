# Pack Authoring (Dev Workflow)

How a developer edits and publishes the bundled `default-pack.json` — the base
form pack every vault starts from. This is a **dev-only** workflow; the bundled
pack is a build artifact, not something end users edit. (End users customize
*their own* forms through the in-app Form Editor — see the last section — which
is a different, shipped feature.)

> There is no longer a compile-time "creator mode": no `VITE_CREATOR_MODE`, no
> `creator-mode` Cargo feature, and no in-app `CreatorModePage`. Pack authoring
> happens in a standalone dev tool.

## The Pack Editor

The Pack Editor (`apps/desktop/pack-editor/`) is a dev-only Vite app that edits
`default-pack.json` — its sections, groups, and fields. A left rail lists the
sections (drag to reorder, click to select, rename inline); the right pane edits
the selected field, or the section itself when no field is selected. **Design**,
**Preview**, and **JSON** tabs show the working pack. Its dev-server plugin
(`pack-editor/save-plugin.mjs`) reads and writes the pack file directly.

## Shipping a pack change — step by step

This is the full loop from an idea to a change that reaches new installs.

### 1. Start from a clean tree, on a branch

```powershell
git status
```

The working tree must be clean. The Pack Editor writes straight to disk the
moment you hit Save — there is no staging step — so an edit left over from a
previous session will otherwise ride along in an unrelated commit.

```powershell
git checkout main; git pull; git checkout -b pack/<short-description>
```

### 2. Back up, then edit

```powershell
npm run pack-editor   # standalone Vite app on http://localhost:1430
```

Click **Back up packs** first: it copies the current on-disk pack into
`scripts/pack-backups/<timestamp>/` (gitignored). That is your undo if you
mangle something and don't want to rely on git.

Then edit and **Save**. The save writes
`apps/desktop/src-tauri/resources/packs/default-pack.json` and is validated by
the same `validatePack` gate the app uses; a validation failure blocks the write
and shows the error.

### 3. See it in the real app

```powershell
npm run dev
```

Dev builds read packs from the source `resources/` dir, so a pack-editor save
hot-reloads into the running app. Create a **fresh vault** to check it — an
existing vault may not show the change, for the reason in step 5.

### 4. Decide whether the change is breaking

The step with real consequences.

**Additive** — a new optional field, a new section, a relabel, a reorder, a
helper-text change. Nothing further needed.

**Breaking** — removing a field, changing a field's `type`, removing a group or
section, reducing cardinality. Any existing value under that key becomes an
**archived answer** on next load: preserved with its original label and a
reason, but no longer shown in the form.

If a breaking change should carry values across instead of archiving them, add
a migration op to the pack's `migrations` array and bump its `schemaVersion`
**by hand** in the JSON.

> **The Pack Editor does not derive migrations.** `deriveAutoMigration` runs
> only on the in-app Form Editor's save path (`Dashboard.tsx`), never on the
> bundled pack. If you edit the bundled pack and don't write the migration
> yourself, there is no migration.

**Choosing a section's identifying field** is a UI control, not a hand-edit:
select the field and check **"Identifying field"** in its panel. It sets that
field `protected` + `required` and adds it to the section's
`readinessRule.requiredKeys` without touching any other identifying field the
section already has — a section can name more than one (Digital Executors
names two). Unchecking releases the field back to ordinary and drops it from
the rule.

This field drives the **fallback record label** — what a record is called on
the dashboard and the Recovery Kit when the section has no explicit
`recordLabel` — and nothing else. It does **not** affect whether the dashboard
shows the section as "ready"; that is a separate, explicit "Mark as complete"
decision the *end user* makes (`domain/readiness.ts`), not something a pack
author configures. Get the label field wrong and a section's records read
poorly on the dashboard and the Kit — that's exactly how Backups & Storage
ended up labeled by its fallback field after a restructure, before this
control existed — but it will never silently change what counts as "done".

There is still no equivalent control for a section's **groups** — no UI path
creates, renames, or removes one. A section that legitimately needs more than
one group (structurally distinct from `multiRecord`, which repeats one group)
has to be authored by hand-editing the JSON.

### 5. Know who actually receives it

`resolveBasePack` returns the user's `customPack` when they have one, and the
bundled pack otherwise. So a bundled-pack change reaches:

| Who | Gets the change? |
|---|---|
| New installs | Yes |
| Existing vaults that never used the in-app Form Editor | Yes, on next unlock |
| Existing vaults with a `customPack` | **Never** |

A user who has customized their own forms is frozen on their own pack, and
there is no merge path back. Irrelevant while the app is unreleased; load-bearing
after.

### 6. Run the gates

```powershell
npm --prefix apps/desktop run test
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
```

Run the **full** frontend suite, not just the pack tests. `defaultPack.test.ts`
asserts the shipped pack's shape, and `fieldOps` and the Recovery Kit tests
assert against it too — so even a pure reorder can break something outside the
obvious file.

Add the pack editor's own two gates if you touched anything under
`apps/desktop/pack-editor/` (see [Testing pack-authoring logic](#testing-pack-authoring-logic)).

### 7. Review the diff, then commit

```powershell
git diff apps/desktop/src-tauri/resources/packs/default-pack.json
```

Worth reading properly. Moving one field renumbers `order` across its whole
group, so a small intent can produce a large diff — confirm nothing moved that
you didn't mean to move.

```powershell
git add apps/desktop/src-tauri/resources/packs/default-pack.json
git commit -m "feat(pack): <what changed>"
git push -u origin HEAD
gh pr create --fill
```

## Adding a credential-bearing field

If a new field is meant to hold a secret — a password, a PIN, a recovery code —
it must **not** appear in any section's `kitMapping`. The Recovery Kit is a
printable document, and while it does resolve a `select` to its option's label
and a `file` to its filename, that's display, not redaction — nothing is
hidden by field name or type.

`validatePack` rejects the keys in `KIT_EXCLUDED_SYSTEM_KEYS`, but that is a
literal list of two systemKeys. A *new* credential field is not covered by it
and would print. Add the key to that list in `packValidation.ts` — the
consumption-side filters in `recoveryKit.ts` and `recordReferences.ts` both read
the same constant, so every gate picks it up together.

Remember there are **two** ways a value reaches the Kit: the section's own
`kitMapping`, and a `recordRef` in some *other* section using it as a display
field. Both are gated, but only for keys on that list — which is why the list is
the thing to update, not any individual call site.

## Linking one section's records to another (`recordRef`)

A `recordRef` field lets a record point at a record in another section — a
backup naming which device it protects, a subscription naming which account pays
for it. Choose the target section and the fields that compose each option's
label; the field stores the target record's id, so renaming the target updates
every reference to it automatically.

Authoring notes:

- **Pick display fields that identify the record to a human.** They appear in
  the picker *and*, if the reference is kit-mapped, on the printed Recovery Kit.
- **Credential fields are not offered** as display fields, and `validatePack`
  rejects a pack that names one anyway.
- **`last4` is cosmetic.** It renders `•••• 1234` for readability. It is not
  masking — the full value is still in the vault and still prints wherever it is
  mapped into the Kit directly.
- **A record cannot be deleted while something references it.** The app blocks
  the delete and lists what points at it; clear those references first. Plan for
  this when choosing which section is the "source" — the referenced section
  becomes harder to prune.
- A reference cannot point at its own section, and cannot display another
  `recordRef`.

## Giving a section's records a readable label

A multi-record section shows each record collapsed to one line. Without help
that line is the first readiness value, which reads badly when records share it
— two cards at the same bank both showing "Chase". Add a section-level
`recordLabel` to compose several fields:

```jsonc
"recordLabel": { "fields": ["accountInstitution", "accountName"], "separator": " — " }
```

Two rules worth knowing when choosing the fields:

- **Kit-map every field you name.** The printed Recovery Kit composes its block
  label from the fields it already prints, so a `recordLabel` field missing from
  that section's `kitMapping` is silently skipped *on the Kit only* — the app
  still shows it. That asymmetry is deliberate (a label must never become a
  route to an unmapped value), but it means an unmapped label field gives you a
  worse Kit than you designed.
- **Credential keys are rejected**, in the label as everywhere else.

## The `write_default_pack` command

The Rust `write_default_pack` command overwrites the source pack file. It is
**always compiled** (no feature gate) but only effective in a dev checkout: it
resolves the path via `CARGO_MANIFEST_DIR`, so in a production install it targets
a path that doesn't exist and returns a `FileOperation` error. It is never a way
for end users to mutate the shipped resource.

## Structure-only guarantees

Pack authoring and export are **structure only** — never personal field values,
never `custom.*` overlay keys (those are user-data slots). `packExport.ts`'s
`creatorOnlyErrors` rejects any pack definition that carries `custom.*` keys, and
`validatePack` is the single gate for all pack JSON (bundled or imported).

## In-app Form Editor (a separate, shipped feature)

Distinct from pack authoring: end users can edit **their own** pack from inside
the app via the **Form Editor** — a runtime sidebar toggle persisted in
`localStorage` as `lifescribe.packEditorEnabled`. It edits the user's `customPack`
inside their encrypted snapshot using the master-detail `FieldList` /
`FieldPropertyPanel` UI, and saves through the normal validated CAS path. This
ships in end-user builds and never touches the bundled `default-pack.json`.

Note the asymmetry with the Pack Editor: on **this** path a breaking edit runs
`deriveAutoMigration`, which emits migration ops and bumps `schemaVersion`
automatically. On the bundled-pack path it does not — you write those by hand.

## Testing pack-authoring logic

```powershell
npm --prefix apps/desktop run test -- src/creator
```

The pack-editing logic lives in `apps/desktop/src/creator/` (`packEdits`,
`packAutoMigrate`, `packExport`) with colocated `.test.ts` files; the Pack
Editor's own UI and save plugin are tested under `apps/desktop/pack-editor/`.
The Rust `write_default_pack` / read path is covered by the pack-resources
integration tests.

The pack editor has its own tsconfig and eslint config, so it is **not** covered
by `npm run typecheck` / `npm run lint`. Run both of its gates too:

```powershell
npm --prefix apps/desktop run typecheck:pack-editor
npm --prefix apps/desktop run lint:pack-editor
```

## What the pack format no longer has

Until 2026-07-30 the pack carried a `modules` array — onboarding questions whose
answers composed optional fields and sections into the pack at load. That system
is gone. Every field is now either protected (structural) or ordinary and
optional, present in the pack as authored. If you are reading an older spec or
plan under `docs/superpowers/` that describes `FormModule`s, `composePack`, or
an "overlay editor" with module targets, it is a historical record.
