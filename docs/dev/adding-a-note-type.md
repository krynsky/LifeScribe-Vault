# Adding a new note type

1. Define a Pydantic model in `apps/backend/src/lifescribe/vault/schemas.py` that extends `_NoteBase` (plus `_ProvenanceMixin` if the note carries provenance). Declare a `Literal` for `type` and a `model_validator` enforcing the id prefix.
2. Add the new type to the `Note` discriminated union.
3. Add a branch to `_relative_path_for` in `store.py` that returns the correct on-disk path.
4. Add a Pydantic round-trip test in `apps/backend/tests/test_schemas.py`.
5. Add a `VaultStore.write_note` integration test covering a typical write path.
6. Regenerate shared TS types: `bash scripts/gen-types.sh`.
7. Document the type in `docs/user/` if user-facing.
