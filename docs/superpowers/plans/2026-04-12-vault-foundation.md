# Vault Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational data contract and project scaffolding for LifeScribe Vault — a cross-platform desktop app whose vault is the system of record. At the end of this plan, the app launches on Windows/macOS/Linux, shows a first-run wizard, creates or opens an Obsidian-compatible Markdown vault, and exposes a typed `VaultStore` API with idempotent writes, hand-edit safety, and git-backed history.

**Architecture:** Tauri v2 desktop shell spawns a Python FastAPI backend as a sidecar binary. The React/TypeScript frontend calls the backend over `127.0.0.1`-only HTTP with a per-launch auth token. The backend's `vault/` module owns all on-disk writes; no other code touches vault files directly. Runtime state (future: jobs, indexes) lives in SQLite; durable facts live in the vault as Markdown + assets. Git is the source of truth for "was this hand-edited."

**Tech Stack:** Tauri v2 (Rust), React 18 + TypeScript + Vite, Python 3.12 + FastAPI + Pydantic v2, `python-frontmatter`, PyInstaller, uv for Python dependency management, pytest, vitest, ruff, mypy, eslint, prettier, GitHub Actions.

---

## Spec References

- Parent umbrella: [`../specs/2026-04-12-lifescribe-vault-overview.md`](../specs/2026-04-12-lifescribe-vault-overview.md)
- This sub-project spec: [`../specs/2026-04-12-vault-foundation-design.md`](../specs/2026-04-12-vault-foundation-design.md)

## File Structure Map

Files this plan creates (listed under the task that first creates them):

```
/
  .gitattributes                             # Task 1
  CONTRIBUTING.md                            # Task 1
  CODE_OF_CONDUCT.md                         # Task 1
  .github/
    ISSUE_TEMPLATE/
      bug_report.md                          # Task 1
      feature_request.md                     # Task 1
    PULL_REQUEST_TEMPLATE.md                 # Task 1
    workflows/
      ci.yml                                 # Task 2
  docs/
    user/
      install.md                             # Task 23
      create-vault.md                        # Task 23
      open-vault.md                          # Task 23
    dev/
      architecture.md                        # Task 23
      running-locally.md                     # Task 23
      adding-a-note-type.md                  # Task 23
  apps/
    backend/
      pyproject.toml                         # Task 3
      uv.lock                                # Task 3 (generated)
      ruff.toml                              # Task 3
      mypy.ini                               # Task 3
      src/lifescribe/
        __init__.py                          # Task 3
        vault/
          __init__.py                        # Task 3
          ids.py                             # Task 4
          schemas.py                          # Task 5
          serialization.py                    # Task 6
          gitwrap.py                          # Task 7
          store.py                            # Task 8, 9, 10
          errors.py                           # Task 8
        migrations/
          __init__.py                         # Task 11
          framework.py                        # Task 11
        api/
          __init__.py                         # Task 12
          app.py                              # Task 12
          auth.py                             # Task 12
          routers/
            __init__.py                       # Task 13
            vault.py                          # Task 13
          main.py                             # Task 12
      tests/
        __init__.py                           # Task 3
        test_ids.py                           # Task 4
        test_schemas.py                       # Task 5
        test_serialization.py                 # Task 6
        test_gitwrap.py                       # Task 7
        test_store_init_open.py               # Task 8
        test_store_write_read.py              # Task 9
        test_store_batch_assets_list.py       # Task 10
        test_migrations.py                    # Task 11
        test_api_auth.py                      # Task 12
        test_api_vault_routes.py              # Task 13
        integration/
          __init__.py                         # Task 22
          test_end_to_end.py                  # Task 22
    desktop/
      package.json                            # Task 16
      tsconfig.json                           # Task 16
      vite.config.ts                          # Task 16
      index.html                              # Task 16
      src/
        main.tsx                              # Task 16
        App.tsx                               # Task 16, 19
        api/
          client.ts                           # Task 18
        views/
          FirstRunWizard.tsx                  # Task 19
          EmptyVault.tsx                      # Task 19
        styles/
          global.css                          # Task 16
      src-tauri/
        tauri.conf.json                       # Task 16
        Cargo.toml                            # Task 16
        build.rs                              # Task 16
        src/
          main.rs                             # Task 16, 17
          sidecar.rs                          # Task 17
  packages/
    shared-types/
      package.json                            # Task 18
      src/
        index.ts                              # Task 18 (generated)
  scripts/
    build-backend.sh                          # Task 14
    build-backend.ps1                         # Task 14
    dev.sh                                    # Task 21
    dev.ps1                                   # Task 21
    gen-types.sh                              # Task 18
    gen-types.ps1                             # Task 18
```

---

## Phase A — Repo governance & CI

### Task 1: Add governance docs and line-ending normalization

**Files:**
- Create: `.gitattributes`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Create `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.ico binary
*.woff binary
*.woff2 binary
*.zip binary
```

- [ ] **Step 2: Create `CONTRIBUTING.md`**

```markdown
# Contributing to LifeScribe Vault

Thanks for your interest. LifeScribe Vault is MIT-licensed and welcomes
contributions.

## Project layout
- `apps/backend/` — Python FastAPI backend (the vault's sole writer)
- `apps/desktop/` — Tauri v2 + React/TypeScript desktop app
- `packages/shared-types/` — TypeScript types generated from the backend OpenAPI schema
- `docs/` — user and developer documentation; design specs and plans live under `docs/superpowers/`

## Running locally
See [`docs/dev/running-locally.md`](docs/dev/running-locally.md).

## Tests
- Backend: `cd apps/backend && uv run pytest`
- Frontend: `cd apps/desktop && npm test`

## Pre-commit hooks (optional)
Recommended but not enforced. See [`docs/dev/running-locally.md`](docs/dev/running-locally.md).

## Code style
- Python: `ruff format`, `ruff check`, `mypy --strict`
- TypeScript: `prettier`, `eslint`, `tsc --noEmit`
- Rust: `cargo fmt`, `cargo clippy -- -D warnings`

## Pull requests
- One logical change per PR.
- Include a test that fails before your change and passes after.
- CI must pass on Windows, macOS, and Linux.
```

- [ ] **Step 3: Create `CODE_OF_CONDUCT.md`**

Use the Contributor Covenant 2.1 verbatim. Copy from <https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md>.

Save as `CODE_OF_CONDUCT.md` with contact email left as `<TODO: maintainer email>` **only** if no maintainer email exists; otherwise fill in. (For this plan, leave the placeholder; the owner will set it before release.)

- [ ] **Step 4: Create `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Report unexpected behavior
labels: bug
---

## What happened

## What you expected

## Reproduction steps
1.
2.
3.

## Environment
- OS:
- App version:
- Vault schema version (see `system/vault.md`):

## Logs / screenshots
```

- [ ] **Step 5: Create `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest a new feature
labels: enhancement
---

## Problem / motivation

## Proposed solution

## Alternatives considered
```

- [ ] **Step 6: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## Summary

## Related spec / plan
<!-- Link to a design doc under docs/superpowers/specs/ if applicable -->

## Test plan
- [ ]
- [ ]

## Checklist
- [ ] Tests added/updated
- [ ] Docs updated if user-facing behavior changed
- [ ] CI green on all three OSes
```

- [ ] **Step 7: Commit**

```bash
git add .gitattributes CONTRIBUTING.md CODE_OF_CONDUCT.md .github/
git commit -m "chore: add governance docs and line-ending normalization"
```

---

### Task 2: Add GitHub Actions CI matrix

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: apps/backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        uses: astral-sh/setup-uv@v3
      - name: Install dependencies
        run: uv sync --frozen
      - name: Lint
        run: |
          uv run ruff format --check .
          uv run ruff check .
      - name: Typecheck
        run: uv run mypy src
      - name: Test
        run: uv run pytest -v

  frontend:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: apps/desktop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install Linux Tauri deps
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libgtk-3-dev libayatana-appindicator3-dev
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - run: npm ci
      - name: Lint JS/TS
        run: |
          npm run lint
          npm run format:check
          npm run typecheck
      - name: Lint Rust
        working-directory: apps/desktop/src-tauri
        run: |
          cargo fmt --check
          cargo clippy -- -D warnings
      - name: Test
        run: npm test -- --run
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add cross-platform CI matrix for backend and frontend"
```

Note: CI will fail until subsequent tasks land the backend and frontend packages. That's fine — it'll go green once Tasks 3 and 16 are done.

---

## Phase B — Backend scaffold

### Task 3: Scaffold the Python backend package

**Files:**
- Create: `apps/backend/pyproject.toml`
- Create: `apps/backend/ruff.toml`
- Create: `apps/backend/mypy.ini`
- Create: `apps/backend/src/lifescribe/__init__.py`
- Create: `apps/backend/src/lifescribe/vault/__init__.py`
- Create: `apps/backend/tests/__init__.py`
- Create: `apps/backend/tests/conftest.py`

- [ ] **Step 1: Create `apps/backend/pyproject.toml`**

```toml
[project]
name = "lifescribe"
version = "0.1.0"
description = "LifeScribe Vault backend"
requires-python = ">=3.12"
license = { text = "MIT" }
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "python-frontmatter>=1.1",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
  "ruff>=0.6",
  "mypy>=1.11",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/lifescribe"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 2: Create `apps/backend/ruff.toml`**

```toml
line-length = 100
target-version = "py312"

[lint]
select = ["E", "F", "I", "B", "UP", "SIM", "RUF"]
ignore = ["E501"]

[format]
quote-style = "double"
```

- [ ] **Step 3: Create `apps/backend/mypy.ini`**

```ini
[mypy]
python_version = 3.12
strict = True
warn_unused_configs = True
mypy_path = src

[mypy-frontmatter.*]
ignore_missing_imports = True
```

- [ ] **Step 4: Create package init files**

`apps/backend/src/lifescribe/__init__.py`:
```python
"""LifeScribe Vault backend."""
__version__ = "0.1.0"
```

`apps/backend/src/lifescribe/vault/__init__.py`:
```python
"""Vault storage primitives."""
```

`apps/backend/tests/__init__.py`: (empty file)

- [ ] **Step 5: Create `apps/backend/tests/conftest.py`**

```python
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Iterator[Path]:
    """Provide a fresh, empty directory suitable for vault init."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    yield vault_dir
```

- [ ] **Step 6: Sync deps with uv**

Run: `cd apps/backend && uv sync --extra dev`
Expected: creates `.venv/` and `uv.lock`.

- [ ] **Step 7: Verify smoke-level tooling**

Run: `cd apps/backend && uv run ruff check . && uv run mypy src && uv run pytest -v`
Expected: ruff clean, mypy clean (no source to check yet is OK — mypy will report success), pytest "no tests ran" exit 5 is acceptable at this stage; we'll fix that the moment Task 4 adds a test.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/pyproject.toml apps/backend/ruff.toml apps/backend/mypy.ini apps/backend/src apps/backend/tests apps/backend/uv.lock
git commit -m "feat(backend): scaffold Python package with uv/ruff/mypy/pytest"
```

---

### Task 4: Canonical ID generation

**Files:**
- Create: `apps/backend/src/lifescribe/vault/ids.py`
- Test: `apps/backend/tests/test_ids.py`

ID format per spec §8: `<type>_<slug>_<short-hash>`. Slug is lowercased, non-alphanumeric → `-`, collapsed, trimmed, capped at 40 chars. Short-hash is first 4 chars of `base32(sha256(content))`, lowercased, no padding.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_ids.py`:

```python
from __future__ import annotations

import pytest

from lifescribe.vault.ids import (
    compose_id,
    content_short_hash,
    sanitize_slug,
)


class TestSanitizeSlug:
    def test_lowercases(self) -> None:
        assert sanitize_slug("Quarterly Report") == "quarterly-report"

    def test_collapses_non_alphanumeric(self) -> None:
        assert sanitize_slug("foo!!!bar???baz") == "foo-bar-baz"

    def test_collapses_dashes(self) -> None:
        assert sanitize_slug("foo---bar") == "foo-bar"

    def test_strips_leading_and_trailing_dashes(self) -> None:
        assert sanitize_slug("---foo---") == "foo"

    def test_caps_at_40_chars(self) -> None:
        s = sanitize_slug("a" * 100)
        assert len(s) == 40
        assert s == "a" * 40

    def test_falls_back_to_untitled_if_empty(self) -> None:
        assert sanitize_slug("!!!") == "untitled"
        assert sanitize_slug("") == "untitled"

    def test_unicode_stripped(self) -> None:
        assert sanitize_slug("café résumé") == "caf-r-sum"


class TestContentShortHash:
    def test_deterministic(self) -> None:
        assert content_short_hash(b"hello") == content_short_hash(b"hello")

    def test_different_content_different_hash(self) -> None:
        assert content_short_hash(b"hello") != content_short_hash(b"goodbye")

    def test_length_is_4(self) -> None:
        assert len(content_short_hash(b"hello")) == 4

    def test_lowercase_base32(self) -> None:
        h = content_short_hash(b"hello")
        assert h.islower()
        assert all(c in "abcdefghijklmnopqrstuvwxyz234567" for c in h)


class TestComposeId:
    def test_format(self) -> None:
        out = compose_id(type_prefix="src", slug="foo-bar", short_hash="abcd")
        assert out == "src_foo-bar_abcd"

    def test_sanitizes_slug(self) -> None:
        out = compose_id(type_prefix="src", slug="Foo Bar!!", short_hash="abcd")
        assert out == "src_foo-bar_abcd"

    def test_rejects_bad_prefix(self) -> None:
        with pytest.raises(ValueError):
            compose_id(type_prefix="SRC", slug="foo", short_hash="abcd")
        with pytest.raises(ValueError):
            compose_id(type_prefix="", slug="foo", short_hash="abcd")

    def test_rejects_bad_hash(self) -> None:
        with pytest.raises(ValueError):
            compose_id(type_prefix="src", slug="foo", short_hash="abc")
        with pytest.raises(ValueError):
            compose_id(type_prefix="src", slug="foo", short_hash="ABCD")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_ids.py -v`
Expected: all fail with `ModuleNotFoundError: No module named 'lifescribe.vault.ids'`.

- [ ] **Step 3: Implement `ids.py`**

`apps/backend/src/lifescribe/vault/ids.py`:

```python
from __future__ import annotations

import base64
import hashlib
import re

_SLUG_MAX_LEN = 40
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_PREFIX_RE = re.compile(r"^[a-z]+$")
_HASH_RE = re.compile(r"^[a-z2-7]{4}$")


def sanitize_slug(raw: str) -> str:
    """Lowercase, collapse non-alphanumerics to dashes, trim, cap at 40 chars.

    Falls back to ``"untitled"`` if the result would be empty.
    """
    lowered = raw.lower()
    replaced = _NON_ALNUM.sub("-", lowered)
    stripped = replaced.strip("-")
    if not stripped:
        return "untitled"
    return stripped[:_SLUG_MAX_LEN].rstrip("-") or "untitled"


def content_short_hash(content: bytes) -> str:
    """Return the first 4 chars of lowercase-base32(sha256(content))."""
    digest = hashlib.sha256(content).digest()
    b32 = base64.b32encode(digest).decode("ascii").lower().rstrip("=")
    return b32[:4]


def compose_id(*, type_prefix: str, slug: str, short_hash: str) -> str:
    """Compose a canonical id as ``<prefix>_<slug>_<hash>``.

    ``slug`` is sanitized; ``type_prefix`` must match ``^[a-z]+$``; ``short_hash``
    must be exactly 4 lowercase base32 chars.
    """
    if not _PREFIX_RE.match(type_prefix):
        raise ValueError(f"Invalid type prefix: {type_prefix!r}")
    if not _HASH_RE.match(short_hash):
        raise ValueError(f"Invalid short hash: {short_hash!r}")
    return f"{type_prefix}_{sanitize_slug(slug)}_{short_hash}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_ids.py -v`
Expected: all pass.

- [ ] **Step 5: Run linters**

Run: `cd apps/backend && uv run ruff check . && uv run ruff format --check . && uv run mypy src`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/vault/ids.py apps/backend/tests/test_ids.py
git commit -m "feat(vault): canonical ID generation (slug + content hash)"
```

---

### Task 5: Pydantic schemas for all v1 note types

**Files:**
- Create: `apps/backend/src/lifescribe/vault/schemas.py`
- Test: `apps/backend/tests/test_schemas.py`

Schemas per spec §7. Enum for privacy labels. Discriminated union on `type`.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_schemas.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from lifescribe.vault.schemas import (
    ConnectorRecord,
    DocumentRecord,
    IngestionLogEntry,
    Note,
    PrivacyLabel,
    SourceRecord,
    VaultManifest,
    parse_note,
)


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=timezone.utc)


class TestSourceRecord:
    def _valid(self) -> dict[str, object]:
        return {
            "id": "src_foo_abcd",
            "type": "SourceRecord",
            "schema_version": 1,
            "source_path": "/tmp/foo.pdf",
            "source_hash": "sha256:abc",
            "source_mtime": _ts(),
            "imported_at": _ts(),
            "imported_by_job": "job_2026-04-12_001",
            "extractor": "test@0.0.1",
            "extractor_confidence": 1.0,
            "privacy": "private",
            "links": {"parent_source": None, "derived_from": []},
            "tags": [],
            "mime_type": "application/pdf",
            "original_filename": "foo.pdf",
            "size_bytes": 1234,
            "page_count": 3,
        }

    def test_valid(self) -> None:
        rec = SourceRecord(**self._valid())  # type: ignore[arg-type]
        assert rec.id == "src_foo_abcd"
        assert rec.privacy is PrivacyLabel.PRIVATE

    def test_rejects_wrong_type(self) -> None:
        data = self._valid()
        data["type"] = "DocumentRecord"
        with pytest.raises(ValidationError):
            SourceRecord(**data)  # type: ignore[arg-type]

    def test_rejects_bad_id_prefix(self) -> None:
        data = self._valid()
        data["id"] = "doc_foo_abcd"
        with pytest.raises(ValidationError):
            SourceRecord(**data)  # type: ignore[arg-type]


class TestVaultManifest:
    def test_valid(self) -> None:
        m = VaultManifest(
            id="vault_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            type="VaultManifest",
            schema_version=1,
            app_version="0.1.0",
            created_at=_ts(),
            migrations=[],
        )
        assert m.schema_version == 1


class TestParseNote:
    def test_dispatches_on_type(self) -> None:
        src = {
            "id": "src_foo_abcd",
            "type": "SourceRecord",
            "schema_version": 1,
            "source_path": "/tmp/x",
            "source_hash": "sha256:xx",
            "source_mtime": _ts(),
            "imported_at": _ts(),
            "imported_by_job": "job_2026-04-12_001",
            "extractor": "e@1",
            "extractor_confidence": 1.0,
            "privacy": "private",
            "links": {"parent_source": None, "derived_from": []},
            "tags": [],
            "mime_type": "text/plain",
            "original_filename": "x.txt",
            "size_bytes": 3,
        }
        note: Note = parse_note(src)
        assert isinstance(note, SourceRecord)

    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValidationError):
            parse_note({"type": "Bogus", "id": "bog_x_abcd"})


class TestDocumentRecord:
    def test_requires_parent_source(self) -> None:
        with pytest.raises(ValidationError):
            DocumentRecord(
                id="doc_x_abcd",
                type="DocumentRecord",
                schema_version=1,
                source_path="/tmp/x",
                source_hash="sha256:y",
                source_mtime=_ts(),
                imported_at=_ts(),
                imported_by_job="job_2026-04-12_001",
                extractor="e@1",
                extractor_confidence=1.0,
                privacy="private",
                links={"parent_source": None, "derived_from": []},
                tags=[],
                parent_source=None,  # type: ignore[arg-type]
                position_in_parent="page 1",
            )


class TestConnectorAndLog:
    def test_connector(self) -> None:
        c = ConnectorRecord(
            id="conn_local_abcd",
            type="ConnectorRecord",
            schema_version=1,
            connector_type="FileConnector",
            auth_ref=None,
            schedule=None,
            last_run=None,
            status="active",
            privacy="private",
            links={"parent_source": None, "derived_from": []},
            tags=[],
        )
        assert c.connector_type == "FileConnector"

    def test_ingestion_log(self) -> None:
        e = IngestionLogEntry(
            id="job_2026-04-12_001",
            type="IngestionLogEntry",
            schema_version=1,
            job_id="job_2026-04-12_001",
            started_at=_ts(),
            finished_at=_ts(),
            inputs=["/tmp/foo.pdf"],
            outputs=["src_foo_abcd"],
            warnings=[],
            errors=[],
        )
        assert e.job_id == e.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_schemas.py -v`
Expected: import error (`lifescribe.vault.schemas` does not exist).

- [ ] **Step 3: Implement `schemas.py`**

`apps/backend/src/lifescribe/vault/schemas.py`:

```python
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PrivacyLabel(str, Enum):
    PRIVATE = "private"
    SHAREABLE = "shareable"
    PUBLISHABLE = "publishable"
    RESTRICTED = "restricted"


class Links(BaseModel):
    parent_source: str | None = None
    derived_from: list[str] = Field(default_factory=list)


class _NoteBase(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    id: str
    schema_version: int = 1
    privacy: PrivacyLabel = PrivacyLabel.PRIVATE
    links: Links = Field(default_factory=Links)
    tags: list[str] = Field(default_factory=list)


class _ProvenanceMixin(BaseModel):
    source_path: str
    source_hash: str
    source_mtime: datetime
    imported_at: datetime
    imported_by_job: str
    extractor: str
    extractor_confidence: float = Field(ge=0.0, le=1.0)


class SourceRecord(_NoteBase, _ProvenanceMixin):
    type: Literal["SourceRecord"]
    mime_type: str
    original_filename: str
    size_bytes: int = Field(ge=0)
    page_count: int | None = None

    @model_validator(mode="after")
    def _check_id_prefix(self) -> "SourceRecord":
        if not self.id.startswith("src_"):
            raise ValueError("SourceRecord id must start with 'src_'")
        return self


class DocumentRecord(_NoteBase, _ProvenanceMixin):
    type: Literal["DocumentRecord"]
    parent_source: str
    position_in_parent: str

    @model_validator(mode="after")
    def _check_id_prefix(self) -> "DocumentRecord":
        if not self.id.startswith("doc_"):
            raise ValueError("DocumentRecord id must start with 'doc_'")
        return self


class ConnectorRecord(_NoteBase):
    type: Literal["ConnectorRecord"]
    connector_type: Literal[
        "FileConnector",
        "ManualExportConnector",
        "APISyncConnector",
        "WatchFolderConnector",
        "BridgeConnector",
    ]
    auth_ref: str | None
    schedule: str | None
    last_run: datetime | None
    status: Literal["active", "paused", "error"]

    @model_validator(mode="after")
    def _check_id_prefix(self) -> "ConnectorRecord":
        if not self.id.startswith("conn_"):
            raise ValueError("ConnectorRecord id must start with 'conn_'")
        return self


class IngestionLogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["IngestionLogEntry"]
    schema_version: int = 1
    job_id: str
    started_at: datetime
    finished_at: datetime
    inputs: list[str]
    outputs: list[str]
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _ids_match(self) -> "IngestionLogEntry":
        if self.id != self.job_id:
            raise ValueError("IngestionLogEntry id must equal job_id")
        if not self.id.startswith("job_"):
            raise ValueError("IngestionLogEntry id must start with 'job_'")
        return self


class MigrationRecord(BaseModel):
    from_version: int = Field(alias="from")
    to_version: int = Field(alias="to")
    applied_at: datetime

    model_config = ConfigDict(populate_by_name=True)


class VaultManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["VaultManifest"]
    schema_version: int
    app_version: str
    created_at: datetime
    migrations: list[MigrationRecord] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_id_prefix(self) -> "VaultManifest":
        if not self.id.startswith("vault_"):
            raise ValueError("VaultManifest id must start with 'vault_'")
        return self


Note = Annotated[
    Union[SourceRecord, DocumentRecord, ConnectorRecord, IngestionLogEntry, VaultManifest],
    Field(discriminator="type"),
]


class _NoteEnvelope(BaseModel):
    note: Note


def parse_note(data: dict[str, object]) -> Note:
    """Parse an untyped dict into the correct Note subclass based on ``type``."""
    return _NoteEnvelope(note=data).note  # type: ignore[arg-type]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_schemas.py -v`
Expected: all pass.

- [ ] **Step 5: Lint + typecheck**

Run: `cd apps/backend && uv run ruff check . && uv run ruff format --check . && uv run mypy src`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/vault/schemas.py apps/backend/tests/test_schemas.py
git commit -m "feat(vault): pydantic schemas for all v1 note types"
```

---

### Task 6: Markdown serialization (Note ↔ file)

**Files:**
- Create: `apps/backend/src/lifescribe/vault/serialization.py`
- Test: `apps/backend/tests/test_serialization.py`

Use `python-frontmatter` for YAML-frontmatter + body parsing. Round-trip contract: parsing then serializing the same file produces byte-equal output (modulo trailing newline normalization).

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_serialization.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.serialization import dump_note, load_note


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=timezone.utc)


def _record() -> SourceRecord:
    return SourceRecord(
        id="src_hello_abcd",
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash="sha256:deadbeef",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=5,
    )


def test_dump_produces_frontmatter_and_body() -> None:
    rec = _record()
    text = dump_note(rec, body="Hello, world.")
    assert text.startswith("---\n")
    assert "id: src_hello_abcd" in text
    assert "\n---\n" in text
    assert text.rstrip().endswith("Hello, world.")


def test_load_round_trips() -> None:
    rec = _record()
    text = dump_note(rec, body="Hello.")
    loaded_note, body = load_note(text)
    assert loaded_note == rec
    assert body.strip() == "Hello."


def test_missing_body_dumps_empty() -> None:
    rec = _record()
    text = dump_note(rec, body="")
    loaded, body = load_note(text)
    assert loaded == rec
    assert body == ""


def test_datetime_serializes_as_iso8601() -> None:
    rec = _record()
    text = dump_note(rec, body="")
    assert "2026-04-12T14:08:03" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_serialization.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `serialization.py`**

`apps/backend/src/lifescribe/vault/serialization.py`:

```python
from __future__ import annotations

from typing import cast

import frontmatter
import yaml

from lifescribe.vault.schemas import Note, parse_note


def dump_note(note: Note, body: str) -> str:
    """Serialize a Note and body to a Markdown file string with YAML frontmatter."""
    data = note.model_dump(mode="json", exclude_none=False)
    yaml_text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True).rstrip("\n")
    return f"---\n{yaml_text}\n---\n{body}"


def load_note(text: str) -> tuple[Note, str]:
    """Parse a Markdown file string into (Note, body). Raises if frontmatter invalid."""
    post = frontmatter.loads(text)
    note = parse_note(cast(dict[str, object], post.metadata))
    return note, post.content
```

Add `pyyaml>=6` to `apps/backend/pyproject.toml` `dependencies`:

```toml
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "python-frontmatter>=1.1",
  "pyyaml>=6",
  "httpx>=0.27",
]
```

Run: `cd apps/backend && uv sync --extra dev`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_serialization.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/vault/serialization.py apps/backend/tests/test_serialization.py apps/backend/pyproject.toml apps/backend/uv.lock
git commit -m "feat(vault): markdown + YAML-frontmatter serialization"
```

---

### Task 7: Git wrapper

**Files:**
- Create: `apps/backend/src/lifescribe/vault/gitwrap.py`
- Test: `apps/backend/tests/test_gitwrap.py`

Thin subprocess wrapper around the system `git` binary (no GitPython dependency). Responsibilities: `init`, `add`, `commit`, `status --porcelain`, detection of whether a given path has uncommitted modifications.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_gitwrap.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.vault.gitwrap import GitRepo, GitError


def test_init_creates_dot_git(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    assert (tmp_vault / ".git").is_dir()
    assert repo.current_branch() == "main"


def test_commit_produces_log_entry(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    (tmp_vault / "a.md").write_text("hello\n", encoding="utf-8")
    repo.add(["a.md"])
    repo.commit("chore: add a", author_name="Tester", author_email="t@example.com")
    log = repo.log_oneline(limit=10)
    assert len(log) == 1
    assert "chore: add a" in log[0]


def test_is_modified_detects_unstaged_edit(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    (tmp_vault / "a.md").write_text("v1\n", encoding="utf-8")
    repo.add(["a.md"])
    repo.commit("chore: v1", author_name="T", author_email="t@t.t")
    assert repo.is_modified("a.md") is False
    (tmp_vault / "a.md").write_text("v2\n", encoding="utf-8")
    assert repo.is_modified("a.md") is True


def test_is_modified_false_for_untracked_path(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    assert repo.is_modified("does-not-exist.md") is False


def test_commit_errors_when_nothing_staged(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    with pytest.raises(GitError):
        repo.commit("chore: empty", author_name="T", author_email="t@t.t")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_gitwrap.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `gitwrap.py`**

`apps/backend/src/lifescribe/vault/gitwrap.py`:

```python
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitError(RuntimeError):
    """A git command failed."""


@dataclass(frozen=True)
class GitRepo:
    root: Path

    @classmethod
    def init(cls, root: Path, *, initial_branch: str = "main") -> "GitRepo":
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        cls._run(root, ["init", "-b", initial_branch])
        return cls(root=root)

    @classmethod
    def open(cls, root: Path) -> "GitRepo":
        root = Path(root)
        if not (root / ".git").exists():
            raise GitError(f"Not a git repository: {root}")
        return cls(root=root)

    def current_branch(self) -> str:
        return self._run(self.root, ["rev-parse", "--abbrev-ref", "HEAD"]).strip()

    def add(self, paths: list[str]) -> None:
        if not paths:
            return
        self._run(self.root, ["add", "--", *paths])

    def commit(
        self,
        message: str,
        *,
        author_name: str,
        author_email: str,
    ) -> None:
        env_extra = {
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
        }
        self._run(self.root, ["commit", "-m", message], env_extra=env_extra)

    def is_modified(self, path: str) -> bool:
        """True iff ``path`` is tracked and has uncommitted modifications."""
        out = self._run(self.root, ["status", "--porcelain", "--", path])
        if not out.strip():
            return False
        status = out[:2]
        return "M" in status or "A" in status and " " in status[1:]

    def log_oneline(self, *, limit: int = 20) -> list[str]:
        out = self._run(self.root, ["log", "--oneline", f"-n{limit}"])
        return [ln for ln in out.splitlines() if ln.strip()]

    @staticmethod
    def _run(
        cwd: Path,
        args: list[str],
        *,
        env_extra: dict[str, str] | None = None,
    ) -> str:
        import os

        env = os.environ.copy()
        if env_extra:
            env.update(env_extra)
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
        except FileNotFoundError as e:
            raise GitError("git binary not found on PATH") from e
        except subprocess.CalledProcessError as e:
            raise GitError(f"git {' '.join(args)} failed: {e.stderr.strip()}") from e
        return result.stdout
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_gitwrap.py -v`
Expected: all pass. If the test runner has no default git identity, the explicit author env vars handle it.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/vault/gitwrap.py apps/backend/tests/test_gitwrap.py
git commit -m "feat(vault): subprocess-based git wrapper"
```

---

## Phase C — Vault primitives

### Task 8: `VaultStore.init` + `open` (VaultManifest + folder skeleton)

**Files:**
- Create: `apps/backend/src/lifescribe/vault/errors.py`
- Create: `apps/backend/src/lifescribe/vault/store.py`
- Test: `apps/backend/tests/test_store_init_open.py`

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_store_init_open.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.store import SCHEMA_VERSION, VaultStore

EXPECTED_FOLDERS = [
    "00_inbox",
    "10_sources",
    "20_entities",
    "30_events",
    "40_domains",
    "50_summaries",
    "60_publish",
    "assets",
    "system",
    "system/connectors",
    "system/logs/ingestion",
    "system/migrations",
]


def test_init_creates_all_folders(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    for folder in EXPECTED_FOLDERS:
        assert (tmp_vault / folder).is_dir(), f"missing {folder}"
    assert (tmp_vault / "system" / "vault.md").is_file()
    assert store.manifest.schema_version == SCHEMA_VERSION


def test_init_writes_gitignore_and_gitattributes(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    assert (tmp_vault / ".gitignore").is_file()
    assert (tmp_vault / ".gitattributes").is_file()
    assert (tmp_vault / ".git").is_dir()


def test_init_commits_initial_state(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    log = store._repo.log_oneline()
    assert len(log) == 1
    assert "chore: initialize vault" in log[0]


def test_init_rejects_existing_vault(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    with pytest.raises(VaultAlreadyInitializedError):
        VaultStore.init(tmp_vault, app_version="0.1.0")


def test_open_loads_manifest(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    store = VaultStore.open(tmp_vault, app_version="0.1.0")
    assert store.manifest.schema_version == SCHEMA_VERSION


def test_open_missing_vault_errors(tmp_vault: Path) -> None:
    with pytest.raises(VaultNotFoundError):
        VaultStore.open(tmp_vault, app_version="0.1.0")


def test_open_rejects_newer_schema(tmp_vault: Path) -> None:
    VaultStore.init(tmp_vault, app_version="0.1.0")
    manifest_path = tmp_vault / "system" / "vault.md"
    text = manifest_path.read_text(encoding="utf-8")
    text = text.replace("schema_version: 1", "schema_version: 99")
    manifest_path.write_text(text, encoding="utf-8")
    with pytest.raises(SchemaTooNewError):
        VaultStore.open(tmp_vault, app_version="0.1.0")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_store_init_open.py -v`
Expected: import errors.

- [ ] **Step 3: Implement `errors.py`**

`apps/backend/src/lifescribe/vault/errors.py`:

```python
from __future__ import annotations


class VaultError(RuntimeError):
    """Base class for vault-level errors."""


class VaultAlreadyInitializedError(VaultError):
    pass


class VaultNotFoundError(VaultError):
    pass


class SchemaTooNewError(VaultError):
    pass


class HandEditedError(VaultError):
    """Raised internally when a write would clobber a hand-edit."""
```

- [ ] **Step 4: Implement `store.py` (init + open only; writes come in Task 9)**

`apps/backend/src/lifescribe/vault/store.py`:

```python
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.gitwrap import GitRepo
from lifescribe.vault.schemas import VaultManifest
from lifescribe.vault.serialization import dump_note, load_note

SCHEMA_VERSION = 1
APP_GIT_AUTHOR_NAME = "LifeScribe Vault"
APP_GIT_AUTHOR_EMAIL = "noreply@lifescribe.local"

_RESERVED_FOLDERS = [
    "00_inbox",
    "20_entities",
    "30_events",
    "40_domains",
    "50_summaries",
    "60_publish",
]
_ACTIVE_FOLDERS = [
    "10_sources",
    "assets",
    "system",
    "system/connectors",
    "system/logs/ingestion",
    "system/migrations",
]

_GITIGNORE = """.obsidian/workspace*
"""
_GITATTRIBUTES = """* text=auto eol=lf
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.pdf binary
*.zip binary
"""

_RESERVED_README = """# Reserved folder

This folder is reserved for a future sub-project. It will be populated
once the associated feature ships. See the top-level overview spec for
the v1 / v2 scope split.
"""


@dataclass
class VaultStore:
    root: Path
    manifest: VaultManifest
    app_version: str
    _repo: GitRepo

    @classmethod
    def init(cls, root: Path, *, app_version: str) -> "VaultStore":
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        if (root / "system" / "vault.md").exists():
            raise VaultAlreadyInitializedError(f"Vault already exists at {root}")

        for folder in _ACTIVE_FOLDERS + _RESERVED_FOLDERS:
            (root / folder).mkdir(parents=True, exist_ok=True)
        for folder in _RESERVED_FOLDERS:
            (root / folder / "README.md").write_text(_RESERVED_README, encoding="utf-8")

        (root / ".gitignore").write_text(_GITIGNORE, encoding="utf-8")
        (root / ".gitattributes").write_text(_GITATTRIBUTES, encoding="utf-8")

        manifest = VaultManifest(
            id=f"vault_{uuid.uuid4()}",
            type="VaultManifest",
            schema_version=SCHEMA_VERSION,
            app_version=app_version,
            created_at=datetime.now(timezone.utc),
            migrations=[],
        )
        (root / "system" / "vault.md").write_text(
            dump_note(manifest, body=""), encoding="utf-8"
        )

        repo = GitRepo.init(root, initial_branch="main")
        repo.add(["-A"])
        repo.commit(
            "chore: initialize vault",
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return cls(root=root, manifest=manifest, app_version=app_version, _repo=repo)

    @classmethod
    def open(cls, root: Path, *, app_version: str) -> "VaultStore":
        root = Path(root)
        manifest_path = root / "system" / "vault.md"
        if not manifest_path.exists():
            raise VaultNotFoundError(f"No VaultManifest at {manifest_path}")
        note, _body = load_note(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(note, VaultManifest):
            raise VaultNotFoundError("system/vault.md is not a VaultManifest")
        if note.schema_version > SCHEMA_VERSION:
            raise SchemaTooNewError(
                f"Vault schema v{note.schema_version} exceeds app max v{SCHEMA_VERSION}"
            )
        repo = GitRepo.open(root)
        return cls(root=root, manifest=note, app_version=app_version, _repo=repo)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_store_init_open.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/vault/errors.py apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_store_init_open.py
git commit -m "feat(vault): VaultStore.init and .open with manifest + skeleton"
```

---

### Task 9: `VaultStore.write_note` / `read_note` with hand-edit detection

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/store.py`
- Test: `apps/backend/tests/test_store_write_read.py`

Adds single-note write with validation, atomic file replacement, git commit per write, and hand-edit conflict routing.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_store_write_read.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=timezone.utc)


def _src(hash_suffix: str = "abcd") -> SourceRecord:
    return SourceRecord(
        id=f"src_hello_{hash_suffix}",
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash=f"sha256:{hash_suffix}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=5,
    )


def test_write_and_read(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src()
    result = store.write_note(rec, body="hi", commit_message="ingest: test")
    assert result.conflict is False
    assert result.path == tmp_vault / "10_sources" / "src_hello_abcd.md"
    loaded_note, body = store.read_note(rec.id)
    assert loaded_note == rec
    assert body == "hi"


def test_write_commits(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    store.write_note(_src(), body="hi", commit_message="ingest: test")
    log = store._repo.log_oneline()
    assert log[0].endswith("ingest: test") or "ingest: test" in log[0]


def test_hand_edit_routes_to_conflict_file(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src()
    first = store.write_note(rec, body="v1", commit_message="ingest: v1")
    # Simulate a hand edit
    first.path.write_text(first.path.read_text(encoding="utf-8") + "\nhand\n", encoding="utf-8")
    second = store.write_note(rec, body="v2", commit_message="ingest: v2")
    assert second.conflict is True
    assert ".conflict-" in second.path.name
    assert second.path.parent == tmp_vault / "10_sources"


def test_exists(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    assert store.exists("src_nope_abcd") is False
    rec = _src()
    store.write_note(rec, body="", commit_message="ingest: x")
    assert store.exists(rec.id) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_store_write_read.py -v`
Expected: `AttributeError: 'VaultStore' object has no attribute 'write_note'`.

- [ ] **Step 3: Extend `store.py`**

Add to `apps/backend/src/lifescribe/vault/store.py` (append before the end of the file):

```python
import os
import tempfile
from dataclasses import dataclass as _dc

from lifescribe.vault.schemas import (
    ConnectorRecord,
    DocumentRecord,
    IngestionLogEntry,
    Note,
    SourceRecord,
    VaultManifest,
)


@_dc
class WriteResult:
    path: Path
    conflict: bool
    committed: bool


def _relative_path_for(note: Note, root: Path) -> Path:
    if isinstance(note, SourceRecord):
        return root / "10_sources" / f"{note.id}.md"
    if isinstance(note, DocumentRecord):
        return root / "10_sources" / note.parent_source / f"{note.id}.md"
    if isinstance(note, ConnectorRecord):
        return root / "system" / "connectors" / f"{note.id}.md"
    if isinstance(note, IngestionLogEntry):
        year_month = note.started_at.strftime("%Y-%m")
        return root / "system" / "logs" / "ingestion" / year_month / f"{note.id}.md"
    if isinstance(note, VaultManifest):
        return root / "system" / "vault.md"
    raise TypeError(f"Unknown note type: {type(note).__name__}")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        delete=False,
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    ) as tmp:
        tmp.write(text)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_name = tmp.name
    os.replace(tmp_name, path)


def _write_note(self: "VaultStore", note: Note, body: str, commit_message: str) -> WriteResult:
    target = _relative_path_for(note, self.root)
    rel = target.relative_to(self.root).as_posix()
    text = dump_note(note, body=body)

    if target.exists() and self._repo.is_modified(rel):
        from datetime import datetime as _dt
        stamp = _dt.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        conflict_path = target.with_name(f"{target.stem}.conflict-{stamp}{target.suffix}")
        _atomic_write(conflict_path, text)
        self._repo.add([conflict_path.relative_to(self.root).as_posix()])
        self._repo.commit(
            f"conflict: {note.id} hand-edited; wrote {conflict_path.name}",
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return WriteResult(path=conflict_path, conflict=True, committed=True)

    _atomic_write(target, text)
    self._repo.add([rel])
    self._repo.commit(
        commit_message,
        author_name=APP_GIT_AUTHOR_NAME,
        author_email=APP_GIT_AUTHOR_EMAIL,
    )
    return WriteResult(path=target, conflict=False, committed=True)


def _read_note(self: "VaultStore", note_id: str) -> tuple[Note, str]:
    for md in self.root.rglob("*.md"):
        if md.stem == note_id:
            return load_note(md.read_text(encoding="utf-8"))
    raise KeyError(f"No note with id {note_id!r} found in vault")


def _exists(self: "VaultStore", note_id: str) -> bool:
    return any(md.stem == note_id for md in self.root.rglob("*.md"))


VaultStore.write_note = _write_note  # type: ignore[attr-defined]
VaultStore.read_note = _read_note  # type: ignore[attr-defined]
VaultStore.exists = _exists  # type: ignore[attr-defined]
```

Note: The monkey-assignment pattern keeps each task's diff small and clearly scoped. Task 10 will refactor these into proper methods on the class. If you prefer to add them as methods directly now, that's fine — the tests drive the behavior contract either way.

**Actually do refactor now**: the monkey-patching is ugly. Replace the append above with direct class methods:

Replace the `@dataclass class VaultStore` definition by adding these methods inside the class body (above the final `@classmethod open`):

```python
    def write_note(
        self,
        note: Note,
        *,
        body: str = "",
        commit_message: str,
    ) -> WriteResult:
        target = _relative_path_for(note, self.root)
        rel = target.relative_to(self.root).as_posix()
        text = dump_note(note, body=body)

        if target.exists() and self._repo.is_modified(rel):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            conflict_path = target.with_name(
                f"{target.stem}.conflict-{stamp}{target.suffix}"
            )
            _atomic_write(conflict_path, text)
            self._repo.add([conflict_path.relative_to(self.root).as_posix()])
            self._repo.commit(
                f"conflict: {note.id} hand-edited; wrote {conflict_path.name}",
                author_name=APP_GIT_AUTHOR_NAME,
                author_email=APP_GIT_AUTHOR_EMAIL,
            )
            return WriteResult(path=conflict_path, conflict=True, committed=True)

        _atomic_write(target, text)
        self._repo.add([rel])
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return WriteResult(path=target, conflict=False, committed=True)

    def read_note(self, note_id: str) -> tuple[Note, str]:
        for md in self.root.rglob("*.md"):
            if md.stem == note_id:
                return load_note(md.read_text(encoding="utf-8"))
        raise KeyError(f"No note with id {note_id!r} found in vault")

    def exists(self, note_id: str) -> bool:
        return any(md.stem == note_id for md in self.root.rglob("*.md"))
```

Move `WriteResult`, `_relative_path_for`, and `_atomic_write` to module level above the class. Remove the monkey-patch block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_store_write_read.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_store_write_read.py
git commit -m "feat(vault): write_note/read_note with hand-edit conflict routing"
```

---

### Task 10: `write_batch`, `write_asset`, `list_notes`, `is_hand_edited`

**Files:**
- Modify: `apps/backend/src/lifescribe/vault/store.py`
- Test: `apps/backend/tests/test_store_batch_assets_list.py`

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_store_batch_assets_list.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=timezone.utc)


def _src(i: int) -> SourceRecord:
    return SourceRecord(
        id=f"src_file-{i}_abcd",
        type="SourceRecord",
        schema_version=1,
        source_path=f"/tmp/file-{i}.txt",
        source_hash=f"sha256:{i:04d}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename=f"file-{i}.txt",
        size_bytes=5,
    )


def test_write_batch_single_commit(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    notes = [_src(i) for i in range(3)]
    results = store.write_batch(
        [(n, f"body-{n.id}") for n in notes],
        commit_message="ingest: batch",
    )
    assert len(results) == 3
    assert all(r.conflict is False for r in results)
    log = store._repo.log_oneline()
    # init commit + single batch commit = 2 entries
    assert len(log) == 2


def test_write_asset(tmp_vault: Path, tmp_path: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    src_file = tmp_path / "image.png"
    src_file.write_bytes(b"\x89PNG fake")
    ref = store.write_asset(src_file, canonical_name="image-abcd.png")
    assert ref.path == tmp_vault / "assets" / "image-abcd.png"
    assert ref.path.read_bytes() == b"\x89PNG fake"


def test_list_notes_filters_by_type(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    store.write_note(_src(0), body="", commit_message="x")
    store.write_note(_src(1), body="", commit_message="y")
    source_ids = sorted(n.id for n in store.list_notes(type_="SourceRecord"))
    assert source_ids == ["src_file-0_abcd", "src_file-1_abcd"]


def test_is_hand_edited(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src(0)
    result = store.write_note(rec, body="v1", commit_message="x")
    assert store.is_hand_edited(rec.id) is False
    result.path.write_text("tampered\n", encoding="utf-8")
    assert store.is_hand_edited(rec.id) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_store_batch_assets_list.py -v`
Expected: `AttributeError` for `write_batch`, `write_asset`, etc.

- [ ] **Step 3: Extend `store.py`**

Add inside the `VaultStore` class:

```python
    def write_batch(
        self,
        items: list[tuple["Note", str]],
        *,
        commit_message: str,
    ) -> list[WriteResult]:
        if not items:
            return []
        results: list[WriteResult] = []
        staged: list[str] = []
        for note, body in items:
            target = _relative_path_for(note, self.root)
            rel = target.relative_to(self.root).as_posix()
            if target.exists() and self._repo.is_modified(rel):
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                conflict_path = target.with_name(
                    f"{target.stem}.conflict-{stamp}{target.suffix}"
                )
                _atomic_write(conflict_path, dump_note(note, body=body))
                staged.append(conflict_path.relative_to(self.root).as_posix())
                results.append(WriteResult(path=conflict_path, conflict=True, committed=False))
            else:
                _atomic_write(target, dump_note(note, body=body))
                staged.append(rel)
                results.append(WriteResult(path=target, conflict=False, committed=False))
        self._repo.add(staged)
        self._repo.commit(
            commit_message,
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )
        return [WriteResult(path=r.path, conflict=r.conflict, committed=True) for r in results]

    def write_asset(self, src: Path, *, canonical_name: str | None = None) -> "AssetRef":
        name = canonical_name or src.name
        dest = self.root / "assets" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(Path(src).read_bytes())
        # Assets are committed alongside notes; caller stages separately if needed.
        return AssetRef(path=dest)

    def list_notes(self, *, type_: str | None = None):
        for md in self.root.rglob("*.md"):
            if md.name in {"README.md"}:
                continue
            try:
                note, _ = load_note(md.read_text(encoding="utf-8"))
            except Exception:
                continue
            if type_ is None or note.type == type_:
                yield note

    def is_hand_edited(self, note_id: str) -> bool:
        for md in self.root.rglob("*.md"):
            if md.stem == note_id:
                return self._repo.is_modified(md.relative_to(self.root).as_posix())
        return False
```

Add at module scope:

```python
@_dc
class AssetRef:
    path: Path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_store_batch_assets_list.py -v`
Expected: all pass.

- [ ] **Step 5: Full backend test suite**

Run: `cd apps/backend && uv run pytest -v`
Expected: all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_store_batch_assets_list.py
git commit -m "feat(vault): write_batch, write_asset, list_notes, is_hand_edited"
```

---

### Task 11: Schema migration framework

**Files:**
- Create: `apps/backend/src/lifescribe/migrations/__init__.py`
- Create: `apps/backend/src/lifescribe/migrations/framework.py`
- Modify: `apps/backend/src/lifescribe/vault/store.py` (add `migrate`)
- Test: `apps/backend/tests/test_migrations.py`

Per spec §12: numbered migration modules, each declaring `from_version`, `to_version`, and `apply(store) -> None`. v1 ships a test-only synthetic migration.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_migrations.py`:

```python
from __future__ import annotations

from pathlib import Path

from lifescribe.migrations.framework import Migration, MigrationReport, apply_migrations
from lifescribe.vault.store import VaultStore


class FakeMigration:
    from_version = 1
    to_version = 2

    called_with: list[VaultStore] = []

    @classmethod
    def apply(cls, store: VaultStore) -> None:
        cls.called_with.append(store)


def test_migration_runs_and_updates_manifest(tmp_vault: Path) -> None:
    FakeMigration.called_with.clear()
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    # Sanity: initial schema is 1
    assert store.manifest.schema_version == 1
    report: MigrationReport = apply_migrations(
        store,
        migrations=[FakeMigration],
        target_version=2,
    )
    assert report.applied == [(1, 2)]
    # Reload to confirm manifest on disk updated
    reopened = VaultStore.open(tmp_vault, app_version="0.1.0")
    assert reopened.manifest.schema_version == 2
    assert len(reopened.manifest.migrations) == 1


def test_no_op_when_already_at_target(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    report = apply_migrations(store, migrations=[FakeMigration], target_version=1)
    assert report.applied == []


def test_migration_protocol_compile_time(tmp_vault: Path) -> None:
    # structural type check: FakeMigration matches Migration
    m: Migration = FakeMigration  # type: ignore[assignment]
    assert m.from_version == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_migrations.py -v`
Expected: import error.

- [ ] **Step 3: Implement framework**

`apps/backend/src/lifescribe/migrations/__init__.py`:
```python
"""Schema migration framework."""
```

`apps/backend/src/lifescribe/migrations/framework.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from lifescribe.vault.schemas import MigrationRecord, VaultManifest
from lifescribe.vault.serialization import dump_note
from lifescribe.vault.store import (
    APP_GIT_AUTHOR_EMAIL,
    APP_GIT_AUTHOR_NAME,
    VaultStore,
)


class Migration(Protocol):
    from_version: int
    to_version: int

    @classmethod
    def apply(cls, store: VaultStore) -> None: ...


@dataclass
class MigrationReport:
    applied: list[tuple[int, int]] = field(default_factory=list)


def apply_migrations(
    store: VaultStore,
    *,
    migrations: list[type[Migration]],
    target_version: int,
) -> MigrationReport:
    report = MigrationReport()
    current = store.manifest.schema_version
    if current >= target_version:
        return report

    ordered = sorted(migrations, key=lambda m: m.from_version)
    for mig in ordered:
        if mig.from_version < current:
            continue
        if mig.from_version >= target_version:
            break
        mig.apply(store)
        current = mig.to_version
        report.applied.append((mig.from_version, mig.to_version))

        now = datetime.now(timezone.utc)
        updated_manifest = VaultManifest(
            id=store.manifest.id,
            type="VaultManifest",
            schema_version=mig.to_version,
            app_version=store.app_version,
            created_at=store.manifest.created_at,
            migrations=[
                *store.manifest.migrations,
                MigrationRecord(**{"from": mig.from_version, "to": mig.to_version, "applied_at": now}),
            ],
        )
        manifest_path = store.root / "system" / "vault.md"
        manifest_path.write_text(dump_note(updated_manifest, body=""), encoding="utf-8")
        store.manifest = updated_manifest
        store._repo.add(["system/vault.md"])
        store._repo.commit(
            f"migrate: v{mig.from_version} → v{mig.to_version}",
            author_name=APP_GIT_AUTHOR_NAME,
            author_email=APP_GIT_AUTHOR_EMAIL,
        )

    return report
```

Add the `migrate` wrapper method to `VaultStore` in `store.py`:

```python
    def migrate(self, target_version: int) -> "MigrationReport":
        from lifescribe.migrations.framework import MigrationReport, apply_migrations
        # In v1 there are no real migrations; callers wire in their own list.
        # This method exists so consumers have a stable API surface.
        return apply_migrations(self, migrations=[], target_version=target_version)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_migrations.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/migrations apps/backend/src/lifescribe/vault/store.py apps/backend/tests/test_migrations.py
git commit -m "feat(migrations): schema migration framework with test migration"
```

---

## Phase D — FastAPI layer

### Task 12: FastAPI app, auth-token middleware, localhost-only bind

**Files:**
- Create: `apps/backend/src/lifescribe/api/__init__.py`
- Create: `apps/backend/src/lifescribe/api/app.py`
- Create: `apps/backend/src/lifescribe/api/auth.py`
- Create: `apps/backend/src/lifescribe/api/main.py`
- Test: `apps/backend/tests/test_api_auth.py`

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_api_auth.py`:

```python
from __future__ import annotations

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app


def test_missing_token_is_401() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 401


def test_wrong_token_is_401() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401


def test_correct_token_200() -> None:
    app = create_app(auth_token="secret")
    with TestClient(app) as client:
        r = client.get("/health", headers={"Authorization": "Bearer secret"})
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_api_auth.py -v`
Expected: import error.

- [ ] **Step 3: Implement the API package**

`apps/backend/src/lifescribe/api/__init__.py`: `"""HTTP API for the LifeScribe backend."""`

`apps/backend/src/lifescribe/api/auth.py`:

```python
from __future__ import annotations

from fastapi import Header, HTTPException, status


def make_auth_dependency(expected_token: str):
    async def _dep(authorization: str | None = Header(default=None)) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        presented = authorization.removeprefix("Bearer ").strip()
        if presented != expected_token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid bearer token")

    return _dep
```

`apps/backend/src/lifescribe/api/app.py`:

```python
from __future__ import annotations

from fastapi import Depends, FastAPI

from lifescribe import __version__
from lifescribe.api.auth import make_auth_dependency


def create_app(*, auth_token: str) -> FastAPI:
    require_auth = make_auth_dependency(auth_token)
    app = FastAPI(
        title="LifeScribe Vault API",
        version=__version__,
        dependencies=[Depends(require_auth)],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
```

`apps/backend/src/lifescribe/api/main.py`:

```python
from __future__ import annotations

import argparse
import os
import secrets

import uvicorn

from lifescribe.api.app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="lifescribe-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)  # 0 = random free port
    parser.add_argument("--auth-token", default=None)
    args = parser.parse_args()

    token = args.auth_token or os.environ.get("LIFESCRIBE_AUTH_TOKEN") or secrets.token_urlsafe(32)
    app = create_app(auth_token=token)
    # Emit the resolved port+token to stdout as one line of JSON so the Tauri shell can parse.
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="warning")
    server = uvicorn.Server(config)

    @app.on_event("startup")
    async def _announce() -> None:
        import json
        import sys

        assigned_port = None
        for s in server.servers:
            for sock in s.sockets:
                assigned_port = sock.getsockname()[1]
                break
            if assigned_port:
                break
        print(
            json.dumps({"host": args.host, "port": assigned_port, "token": token}),
            flush=True,
            file=sys.stdout,
        )

    server.run()


if __name__ == "__main__":
    main()
```

Add `[project.scripts]` entry to `pyproject.toml`:

```toml
[project.scripts]
lifescribe-backend = "lifescribe.api.main:main"
```

Then: `cd apps/backend && uv sync --extra dev`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest tests/test_api_auth.py -v`
Expected: all pass.

- [ ] **Step 5: Manual smoke test**

Run (one line): `cd apps/backend && uv run lifescribe-backend --port 0 --auth-token smoke &`
Expected: prints a JSON line with `host`, `port`, `token`. Then: `curl -sS -H "Authorization: Bearer smoke" http://127.0.0.1:<port>/health`. Kill the process afterwards.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lifescribe/api apps/backend/tests/test_api_auth.py apps/backend/pyproject.toml apps/backend/uv.lock
git commit -m "feat(api): FastAPI app with bearer-token auth and localhost bind"
```

---

### Task 13: Vault routers (`init`, `open`, `status`)

**Files:**
- Create: `apps/backend/src/lifescribe/api/routers/__init__.py`
- Create: `apps/backend/src/lifescribe/api/routers/vault.py`
- Modify: `apps/backend/src/lifescribe/api/app.py`
- Test: `apps/backend/tests/test_api_vault_routes.py`

v1 routes:
- `POST /vault/init { path }` → creates and opens a vault
- `POST /vault/open { path }` → opens an existing vault
- `GET /vault/status` → returns the currently opened vault manifest or `null`

The backend keeps a single in-memory `current_store`. Multi-vault sessions are deferred.

- [ ] **Step 1: Write the failing tests**

`apps/backend/tests/test_api_vault_routes.py`:

```python
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from lifescribe.api.app import create_app


def _client() -> TestClient:
    app = create_app(auth_token="t")
    return TestClient(app)


AUTH = {"Authorization": "Bearer t"}


def test_status_empty(tmp_path: Path) -> None:
    with _client() as c:
        r = c.get("/vault/status", headers=AUTH)
        assert r.status_code == 200
        assert r.json() == {"open": False, "manifest": None}


def test_init_then_status(tmp_path: Path) -> None:
    target = tmp_path / "myvault"
    with _client() as c:
        r = c.post("/vault/init", json={"path": str(target)}, headers=AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["manifest"]["schema_version"] == 1
        r2 = c.get("/vault/status", headers=AUTH)
        assert r2.json()["open"] is True


def test_open_nonexistent_404(tmp_path: Path) -> None:
    with _client() as c:
        r = c.post("/vault/open", json={"path": str(tmp_path / "missing")}, headers=AUTH)
        assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && uv run pytest tests/test_api_vault_routes.py -v`
Expected: 404 on `/vault/status` (route doesn't exist yet).

- [ ] **Step 3: Implement routers**

`apps/backend/src/lifescribe/api/routers/__init__.py`: `"""Routers."""`

`apps/backend/src/lifescribe/api/routers/vault.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from lifescribe import __version__
from lifescribe.vault.errors import (
    SchemaTooNewError,
    VaultAlreadyInitializedError,
    VaultNotFoundError,
)
from lifescribe.vault.store import VaultStore

router = APIRouter(prefix="/vault", tags=["vault"])


class _State:
    store: VaultStore | None = None


class _InitRequest(BaseModel):
    path: str


class _OpenRequest(BaseModel):
    path: str


def _manifest_dict(store: VaultStore) -> dict[str, Any]:
    return store.manifest.model_dump(mode="json")


@router.get("/status")
def status_endpoint() -> dict[str, Any]:
    if _State.store is None:
        return {"open": False, "manifest": None}
    return {"open": True, "manifest": _manifest_dict(_State.store)}


@router.post("/init")
def init_endpoint(req: _InitRequest) -> dict[str, Any]:
    try:
        store = VaultStore.init(Path(req.path), app_version=__version__)
    except VaultAlreadyInitializedError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    _State.store = store
    return {"open": True, "manifest": _manifest_dict(store)}


@router.post("/open")
def open_endpoint(req: _OpenRequest) -> dict[str, Any]:
    try:
        store = VaultStore.open(Path(req.path), app_version=__version__)
    except VaultNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except SchemaTooNewError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    _State.store = store
    return {"open": True, "manifest": _manifest_dict(store)}
```

Modify `apps/backend/src/lifescribe/api/app.py` — wire the router:

```python
from lifescribe.api.routers.vault import router as vault_router

def create_app(*, auth_token: str) -> FastAPI:
    require_auth = make_auth_dependency(auth_token)
    app = FastAPI(
        title="LifeScribe Vault API",
        version=__version__,
        dependencies=[Depends(require_auth)],
    )
    app.include_router(vault_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && uv run pytest -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lifescribe/api apps/backend/tests/test_api_vault_routes.py
git commit -m "feat(api): /vault init/open/status endpoints"
```

---

## Phase E — Backend packaging

### Task 14: PyInstaller build script for single-binary backend

**Files:**
- Create: `scripts/build-backend.sh`
- Create: `scripts/build-backend.ps1`
- Modify: `apps/backend/pyproject.toml` (add pyinstaller to dev deps)

- [ ] **Step 1: Add PyInstaller to dev deps**

Update `[project.optional-dependencies]` in `pyproject.toml`:

```toml
[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
  "ruff>=0.6",
  "mypy>=1.11",
  "pyinstaller>=6.10",
]
```

Run: `cd apps/backend && uv sync --extra dev`

- [ ] **Step 2: Create `scripts/build-backend.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT/apps/backend"

OUT_NAME="lifescribe-backend"
uv run pyinstaller \
  --name "$OUT_NAME" \
  --onefile \
  --clean \
  --noconfirm \
  --console \
  src/lifescribe/api/main.py

echo "Binary at: $ROOT/apps/backend/dist/$OUT_NAME"
```

Make executable: `chmod +x scripts/build-backend.sh`

- [ ] **Step 3: Create `scripts/build-backend.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
Push-Location (Join-Path $root "apps/backend")
try {
    uv run pyinstaller --name lifescribe-backend --onefile --clean --noconfirm --console src/lifescribe/api/main.py
    Write-Host "Binary at: $root/apps/backend/dist/lifescribe-backend.exe"
} finally {
    Pop-Location
}
```

- [ ] **Step 4: Run a local smoke build**

On Unix: `bash scripts/build-backend.sh`
On Windows: `powershell -File scripts/build-backend.ps1`
Expected: a `dist/lifescribe-backend` (or `.exe`) binary is produced. Run it:
`./apps/backend/dist/lifescribe-backend --port 0 --auth-token smoke`
Expected: prints JSON with `port` and `token`; kill it.

- [ ] **Step 5: Add `apps/backend/build/`, `apps/backend/dist/`, and `*.spec` to `.gitignore` if not already**

Append to `.gitignore`:

```
apps/backend/build/
apps/backend/dist/
*.spec
```

- [ ] **Step 6: Commit**

```bash
git add scripts/build-backend.sh scripts/build-backend.ps1 apps/backend/pyproject.toml apps/backend/uv.lock .gitignore
git commit -m "build(backend): PyInstaller single-binary build scripts"
```

---

## Phase F — Frontend scaffold

### Task 15: Tauri v2 + React + Vite + TS scaffold

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/styles/global.css`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/.eslintrc.cjs`
- Create: `apps/desktop/.prettierrc`

- [ ] **Step 1: Create `apps/desktop/package.json`**

```json
{
  "name": "lifescribe-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "lint": "eslint src --ext .ts,.tsx",
    "format:check": "prettier --check src",
    "format": "prettier --write src",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "prettier": "^3.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/desktop/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

- [ ] **Step 4: Create `apps/desktop/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LifeScribe Vault</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create React entry points**

`apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`apps/desktop/src/App.tsx`:

```tsx
export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>LifeScribe Vault</h1>
      <p>Scaffold up. First-run wizard lands in Task 19.</p>
    </div>
  );
}
```

`apps/desktop/src/styles/global.css`:

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  background: #fafafa;
  color: #111;
}
```

- [ ] **Step 6: Create Tauri Rust project files**

`apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "lifescribe-desktop"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

`apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "LifeScribe Vault",
  "version": "0.1.0",
  "identifier": "us.lifescribe.vault",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "LifeScribe Vault",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:*"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"]
  }
}
```

Add a placeholder icon `apps/desktop/src-tauri/icons/icon.png` (any 512×512 PNG is fine for now; Tauri requires one to build).

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running LifeScribe Vault");
}
```

- [ ] **Step 7: Create lint configs**

`apps/desktop/.eslintrc.cjs`:

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
};
```

`apps/desktop/.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 8: Install and smoke-test**

Run: `cd apps/desktop && npm install`
Run: `cd apps/desktop && npm run typecheck && npm run lint && npm run format:check`
Expected: all clean.

Smoke test the Vite dev server separately: `cd apps/desktop && npm run dev`
Expected: serves on :5173; load the URL and see the scaffold H1. Kill with Ctrl-C.

Smoke test Tauri (optional on dev machine, required in CI): `cd apps/desktop && npm run tauri:dev`. Requires Rust toolchain + platform dev deps (libwebkit2gtk on Linux). Kill the window to exit.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): Tauri v2 + React + Vite + TS scaffold"
```

---

### Task 16: Rust sidecar launcher (spawn backend, capture port + token)

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/src/sidecar.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Add sidecar plugin and binary reference**

Update `apps/desktop/src-tauri/Cargo.toml` dependencies:

```toml
[dependencies]
tauri = { version = "2.0", features = [] }
tauri-plugin-shell = "2.0"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rand = "0.8"
```

Update `apps/desktop/src-tauri/tauri.conf.json` — add the sidecar binary:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"],
    "externalBin": ["binaries/lifescribe-backend"]
  }
```

Create `apps/desktop/src-tauri/binaries/` and expect the PyInstaller output to be placed there as per Tauri's sidecar naming convention (`lifescribe-backend-<target-triple>`). For dev, we accept that contributors run `scripts/build-backend.{sh,ps1}` and copy the output to this folder; documented in `docs/dev/running-locally.md` (Task 23).

Add `apps/desktop/src-tauri/binaries/` to `.gitignore`:

```
apps/desktop/src-tauri/binaries/
```

- [ ] **Step 2: Implement sidecar launcher**

`apps/desktop/src-tauri/src/sidecar.rs`:

```rust
use rand::RngCore;
use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Debug, Deserialize)]
pub struct BackendReady {
    pub host: String,
    pub port: u16,
    pub token: String,
}

pub struct BackendState {
    pub ready: Mutex<Option<BackendReady>>,
    pub child: Mutex<Option<CommandChild>>,
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64url_encode(&bytes)
}

fn base64url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0usize;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        out.push(ALPHABET[(n & 63) as usize] as char);
        i += 3;
    }
    out
}

pub fn spawn_backend(app: &AppHandle) -> Result<(), String> {
    let token = generate_token();
    let cmd = app
        .shell()
        .sidecar("lifescribe-backend")
        .map_err(|e| format!("resolve sidecar: {e}"))?
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--auth-token",
            &token,
        ]);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let state: tauri::State<BackendState> = app.state();
    *state.child.lock().unwrap() = Some(child);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line_bytes) = event {
                if let Ok(line) = String::from_utf8(line_bytes) {
                    if let Ok(ready) = serde_json::from_str::<BackendReady>(line.trim()) {
                        let state: tauri::State<BackendState> = app_for_task.state();
                        *state.ready.lock().unwrap() = Some(ready.clone());
                        let _ = app_for_task.emit("backend-ready", ready);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn backend_info(state: tauri::State<BackendState>) -> Option<BackendReady> {
    state.ready.lock().unwrap().clone()
}
```

- [ ] **Step 3: Wire the launcher into `main.rs`**

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::Mutex;

use sidecar::{backend_info, spawn_backend, BackendState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            ready: Mutex::new(None),
            child: Mutex::new(None),
        })
        .setup(|app| {
            spawn_backend(&app.handle()).expect("failed to spawn backend");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_info])
        .run(tauri::generate_context!())
        .expect("error while running LifeScribe Vault");
}
```

- [ ] **Step 4: Verify Rust builds**

Run: `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings`
Expected: clean. Clippy may require `cargo check` first to populate the target dir.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src .gitignore
git commit -m "feat(desktop): Rust sidecar launcher for Python backend"
```

---

### Task 17: Shared TS types generated from OpenAPI

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/src/index.ts` (generated stub initially)
- Create: `scripts/gen-types.sh`
- Create: `scripts/gen-types.ps1`
- Modify: `apps/desktop/package.json` to depend on the shared-types package via a workspace link

- [ ] **Step 1: Create the shared-types package**

`packages/shared-types/package.json`:

```json
{
  "name": "@lifescribe/shared-types",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

`packages/shared-types/src/index.ts`:

```ts
// Regenerated by scripts/gen-types.{sh,ps1} from apps/backend's OpenAPI schema.
// Do not hand-edit.

export interface VaultManifestDTO {
  id: string;
  type: "VaultManifest";
  schema_version: number;
  app_version: string;
  created_at: string;
  migrations: { from: number; to: number; applied_at: string }[];
}

export interface VaultStatusDTO {
  open: boolean;
  manifest: VaultManifestDTO | null;
}
```

The stub is safe to hand-author for now — the generation script replaces it whenever the schema changes.

- [ ] **Step 2: Create the root workspace manifest so `apps/desktop` can import `@lifescribe/shared-types`**

Create `package.json` at repo root:

```json
{
  "name": "lifescribe-vault",
  "private": true,
  "workspaces": ["apps/desktop", "packages/*"]
}
```

Update `apps/desktop/package.json` `dependencies`:

```json
"@lifescribe/shared-types": "*",
```

Run: `npm install` at repo root. This creates `node_modules` with the workspace link.

- [ ] **Step 3: Generation scripts**

`scripts/gen-types.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT/apps/backend"

uv run python -c "
import json
from lifescribe.api.app import create_app
print(json.dumps(create_app(auth_token='x').openapi(), indent=2))
" > "$ROOT/packages/shared-types/openapi.json"

cd "$ROOT"
npx --yes openapi-typescript "packages/shared-types/openapi.json" \
  -o "packages/shared-types/src/generated.ts"

echo "Regenerated packages/shared-types/src/generated.ts"
```

`scripts/gen-types.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
Push-Location (Join-Path $root "apps/backend")
try {
    $schema = uv run python -c "import json; from lifescribe.api.app import create_app; print(json.dumps(create_app(auth_token='x').openapi(), indent=2))"
    $schema | Out-File -Encoding utf8 (Join-Path $root "packages/shared-types/openapi.json")
} finally {
    Pop-Location
}
Push-Location $root
npx --yes openapi-typescript "packages/shared-types/openapi.json" -o "packages/shared-types/src/generated.ts"
Pop-Location
```

Make the bash script executable: `chmod +x scripts/gen-types.sh`

- [ ] **Step 4: Document in README (brief)**

Append to `README.md`:

```markdown
## Regenerating shared types

After changing backend API routes, run:

- Unix: `bash scripts/gen-types.sh`
- Windows: `powershell -File scripts/gen-types.ps1`
```

- [ ] **Step 5: Run the generator and commit the result**

Run: `bash scripts/gen-types.sh` (or the `.ps1` equivalent on Windows).
Expected: `packages/shared-types/src/generated.ts` is created. Inspect: confirms `paths["/vault/status"]` and friends are present.

Update `packages/shared-types/src/index.ts` to re-export generated types:

```ts
export * from "./generated";
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types scripts/gen-types.sh scripts/gen-types.ps1 package.json apps/desktop/package.json package-lock.json README.md
git commit -m "feat(types): workspace package for TS types generated from OpenAPI"
```

---

### Task 18: Typed TS API client

**Files:**
- Create: `apps/desktop/src/api/client.ts`

- [ ] **Step 1: Implement client**

`apps/desktop/src/api/client.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VaultStatusDTO } from "@lifescribe/shared-types";

interface BackendReady {
  host: string;
  port: number;
  token: string;
}

let cached: BackendReady | null = null;

async function getBackend(): Promise<BackendReady> {
  if (cached) return cached;
  const info = await invoke<BackendReady | null>("backend_info");
  if (info) {
    cached = info;
    return info;
  }
  return await new Promise<BackendReady>((resolve) => {
    const unlistenPromise = listen<BackendReady>("backend-ready", (evt) => {
      cached = evt.payload;
      resolve(evt.payload);
      unlistenPromise.then((u) => u());
    });
  });
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const b = await getBackend();
  const res = await fetch(`http://${b.host}:${b.port}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${b.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<VaultStatusDTO>("GET", "/vault/status"),
  init: (path: string) => request<VaultStatusDTO>("POST", "/vault/init", { path }),
  open: (path: string) => request<VaultStatusDTO>("POST", "/vault/open", { path }),
};
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/desktop && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/client.ts
git commit -m "feat(desktop): typed API client with sidecar token auth"
```

---

### Task 19: First-run wizard + empty-vault screen

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/views/FirstRunWizard.tsx`
- Create: `apps/desktop/src/views/EmptyVault.tsx`

- [ ] **Step 1: Implement the wizard and empty view**

`apps/desktop/src/views/FirstRunWizard.tsx`:

```tsx
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api/client";

interface Props {
  onOpened: () => void;
}

export default function FirstRunWizard({ onOpened }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickDirectory(): Promise<string | null> {
    const result = await openDialog({ directory: true, multiple: false });
    if (typeof result === "string") return result;
    return null;
  }

  async function handleCreate() {
    setError(null);
    const path = await pickDirectory();
    if (!path) return;
    setBusy(true);
    try {
      await api.init(path);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    setError(null);
    const path = await pickDirectory();
    if (!path) return;
    setBusy(true);
    try {
      await api.open(path);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "4rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Welcome to LifeScribe Vault</h1>
      <p>Choose how to get started:</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button disabled={busy} onClick={handleCreate}>
          Create new vault
        </button>
        <button disabled={busy} onClick={handleOpen}>
          Open existing vault
        </button>
      </div>
      {error && <p style={{ color: "crimson", marginTop: 16 }}>Error: {error}</p>}
    </div>
  );
}
```

Add the dialog plugin to Rust — append to `apps/desktop/src-tauri/Cargo.toml` deps:

```toml
tauri-plugin-dialog = "2.0"
```

Register it in `apps/desktop/src-tauri/src/main.rs` inside the builder chain:

```rust
        .plugin(tauri_plugin_dialog::init())
```

Install the JS side: `cd apps/desktop && npm install @tauri-apps/plugin-dialog`

`apps/desktop/src/views/EmptyVault.tsx`:

```tsx
import type { VaultManifestDTO } from "@lifescribe/shared-types";

interface Props {
  manifest: VaultManifestDTO;
}

export default function EmptyVault({ manifest }: Props) {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Your vault is empty.</h1>
      <p>Ingestion lands in sub-project 3.2. For now, the vault is ready and tracked in git.</p>
      <dl>
        <dt>Vault ID</dt>
        <dd>
          <code>{manifest.id}</code>
        </dd>
        <dt>Schema version</dt>
        <dd>{manifest.schema_version}</dd>
        <dt>Created</dt>
        <dd>{new Date(manifest.created_at).toLocaleString()}</dd>
      </dl>
    </div>
  );
}
```

`apps/desktop/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { VaultStatusDTO } from "@lifescribe/shared-types";
import { api } from "./api/client";
import FirstRunWizard from "./views/FirstRunWizard";
import EmptyVault from "./views/EmptyVault";

export default function App() {
  const [status, setStatus] = useState<VaultStatusDTO | null>(null);

  async function refresh() {
    try {
      const s = await api.status();
      setStatus(s);
    } catch (e) {
      console.error(e);
      setStatus({ open: false, manifest: null });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (status === null) return <div style={{ padding: 24 }}>Starting backend…</div>;
  if (!status.open || !status.manifest) return <FirstRunWizard onOpened={refresh} />;
  return <EmptyVault manifest={status.manifest} />;
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd apps/desktop && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/main.rs apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "feat(desktop): first-run wizard + empty-vault screen"
```

---

## Phase G — Dev UX, integration test, docs

### Task 20: Dev scripts

**Files:**
- Create: `scripts/dev.sh`
- Create: `scripts/dev.ps1`

Dev mode runs the Vite dev server and launches Tauri against it. The backend runs as a sidecar inside Tauri, so `dev.sh` just delegates to `npm run tauri:dev` — but developers may prefer to run the backend standalone (e.g., with a debugger attached), so the script supports `--standalone-backend`.

- [ ] **Step 1: Create `scripts/dev.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

mode="${1:-full}"

case "$mode" in
  full)
    cd "$ROOT/apps/desktop"
    npm run tauri:dev
    ;;
  backend-only)
    cd "$ROOT/apps/backend"
    uv run lifescribe-backend --host 127.0.0.1 --port 0 --auth-token devtoken
    ;;
  frontend-only)
    cd "$ROOT/apps/desktop"
    npm run dev
    ;;
  *)
    echo "Usage: $0 [full|backend-only|frontend-only]" >&2
    exit 1
    ;;
esac
```

Make executable: `chmod +x scripts/dev.sh`

- [ ] **Step 2: Create `scripts/dev.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
$root = Resolve-Path (Join-Path $here "..")
$mode = if ($args.Count -ge 1) { $args[0] } else { "full" }

switch ($mode) {
    "full" {
        Push-Location (Join-Path $root "apps/desktop")
        npm run tauri:dev
        Pop-Location
    }
    "backend-only" {
        Push-Location (Join-Path $root "apps/backend")
        uv run lifescribe-backend --host 127.0.0.1 --port 0 --auth-token devtoken
        Pop-Location
    }
    "frontend-only" {
        Push-Location (Join-Path $root "apps/desktop")
        npm run dev
        Pop-Location
    }
    default {
        Write-Error "Usage: dev.ps1 [full|backend-only|frontend-only]"
        exit 1
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/dev.sh scripts/dev.ps1
git commit -m "chore(scripts): dev helper for backend/frontend/full runs"
```

---

### Task 21: End-to-end integration test

**Files:**
- Create: `apps/backend/tests/integration/__init__.py`
- Create: `apps/backend/tests/integration/test_end_to_end.py`

Scenario per spec §13: init vault in tempdir, write a SourceRecord + referenced asset, read back, re-write (idempotent), hand-edit detection, synthetic v1→v2 migration.

- [ ] **Step 1: Write the test**

`apps/backend/tests/integration/__init__.py`: (empty)

`apps/backend/tests/integration/test_end_to_end.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from lifescribe.migrations.framework import apply_migrations
from lifescribe.vault.ids import compose_id, content_short_hash, sanitize_slug
from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=timezone.utc)


class SyntheticV2Migration:
    from_version = 1
    to_version = 2

    @classmethod
    def apply(cls, store: VaultStore) -> None:
        marker = store.root / "system" / "migrated-to-v2.marker"
        marker.write_text("ok", encoding="utf-8")
        store._repo.add(["system/migrated-to-v2.marker"])


def test_foundation_end_to_end(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()

    # 1. Init vault
    store = VaultStore.init(vault, app_version="0.1.0")
    assert store.manifest.schema_version == 1

    # 2. Build a SourceRecord whose id is content-derived
    content = b"Hello, world.\n"
    short = content_short_hash(content)
    slug = sanitize_slug("Hello World")
    note_id = compose_id(type_prefix="src", slug=slug, short_hash=short)
    rec = SourceRecord(
        id=note_id,
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash=f"sha256:fake-{short}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="e2e@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=len(content),
    )

    # 3. Write the note + asset
    asset_src = tmp_path / "hello.txt"
    asset_src.write_bytes(content)
    store.write_asset(asset_src, canonical_name=f"hello-{short}.txt")
    store.write_note(rec, body="Hello, world.", commit_message=f"ingest: {rec.id}")

    # 4. Read the note back
    loaded, body = store.read_note(rec.id)
    assert loaded == rec
    assert body == "Hello, world."

    # 5. Re-write identical: should go through (new commit) but stay consistent
    pre_log = store._repo.log_oneline()
    store.write_note(rec, body="Hello, world.", commit_message="ingest: same content")
    post_log = store._repo.log_oneline()
    assert len(post_log) == len(pre_log) + 1

    # 6. Hand-edit detection
    note_path = vault / "10_sources" / f"{rec.id}.md"
    note_path.write_text(note_path.read_text(encoding="utf-8") + "\n<!-- hand -->\n", encoding="utf-8")
    result = store.write_note(rec, body="Hello, world.", commit_message="ingest: should conflict")
    assert result.conflict is True
    assert result.path.name.startswith(f"{rec.id}.conflict-")

    # 7. Migration framework
    report = apply_migrations(store, migrations=[SyntheticV2Migration], target_version=2)
    assert report.applied == [(1, 2)]
    reopened = VaultStore.open(vault, app_version="0.1.0")
    assert reopened.manifest.schema_version == 2
    assert (vault / "system" / "migrated-to-v2.marker").exists()
```

- [ ] **Step 2: Run it**

Run: `cd apps/backend && uv run pytest tests/integration -v`
Expected: the single test passes.

- [ ] **Step 3: Ensure the full suite still passes on all tests**

Run: `cd apps/backend && uv run pytest -v`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/tests/integration
git commit -m "test(vault): end-to-end foundation integration test"
```

---

### Task 22: Stub user + developer documentation

**Files:**
- Create: `docs/user/install.md`
- Create: `docs/user/create-vault.md`
- Create: `docs/user/open-vault.md`
- Create: `docs/dev/architecture.md`
- Create: `docs/dev/running-locally.md`
- Create: `docs/dev/adding-a-note-type.md`

- [ ] **Step 1: Create user docs**

`docs/user/install.md`:

```markdown
# Install LifeScribe Vault

LifeScribe Vault ships as a signed desktop installer for Windows, macOS, and Linux.
Release installers will be attached to GitHub releases once the first release
workflow lands (sub-project 3.2).

For now, to run from source see [`../dev/running-locally.md`](../dev/running-locally.md).
```

`docs/user/create-vault.md`:

```markdown
# Create a new vault

1. Launch LifeScribe Vault.
2. On the first-run screen, click **Create new vault**.
3. Pick an empty directory. The suggested default is `~/Documents/LifeScribe Vault/`.
4. The app scaffolds the folder structure, initializes a git repo, and commits `chore: initialize vault`.

The vault is tracked as a standalone git repository. You can inspect it with
standard git tools at any time.
```

`docs/user/open-vault.md`:

```markdown
# Open an existing vault

1. Launch LifeScribe Vault.
2. Click **Open existing vault** and select a directory containing `system/vault.md`.
3. If the vault's schema version matches the app, it opens. If the vault is older,
   the app offers to migrate. If the vault is newer than the installed app,
   opening is refused — upgrade the app.
```

- [ ] **Step 2: Create developer docs**

`docs/dev/architecture.md`:

```markdown
# Architecture

LifeScribe Vault is a Tauri v2 desktop app with a Python FastAPI backend sidecar.

- `apps/desktop/` — Tauri v2 + React + TypeScript frontend.
- `apps/backend/` — Python 3.12 + FastAPI. Packaged as a single binary via PyInstaller and bundled with the desktop app as a Tauri sidecar.
- `packages/shared-types/` — TypeScript types generated from the backend's OpenAPI schema.

## Startup sequence
1. Tauri shell starts.
2. Rust `spawn_backend` launches the bundled `lifescribe-backend` binary with a random auth token and port.
3. Backend binds `127.0.0.1:<random>`, then prints `{host, port, token}` as a single JSON line to stdout.
4. Rust captures that line and emits a `backend-ready` event. It also exposes the values via the `backend_info` Tauri command.
5. React reads `backend_info`, then makes authenticated HTTP calls to the backend for every vault operation.

## Vault writes
Every vault write goes through `VaultStore` in `apps/backend/src/lifescribe/vault/store.py`. No other code touches vault files directly. This is the firewall that makes the data invariants (provenance, idempotency, hand-edit safety, git history) enforceable.

## Invariants
See [`docs/superpowers/specs/2026-04-12-lifescribe-vault-overview.md`](../superpowers/specs/2026-04-12-lifescribe-vault-overview.md) for the complete list.
```

`docs/dev/running-locally.md`:

```markdown
# Running locally

## Prerequisites
- Git
- Python 3.12 and [uv](https://github.com/astral-sh/uv)
- Node.js 20+
- Rust stable toolchain (via rustup)
- Platform-specific Tauri dependencies:
  - **Linux:** `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`
  - **macOS:** Xcode command line tools
  - **Windows:** WebView2 Runtime (pre-installed on Win 11)

## First-time setup

```bash
# Backend
cd apps/backend
uv sync --extra dev

# Frontend
cd ../..
npm install
```

## Build the backend binary (required for Tauri sidecar)

```bash
bash scripts/build-backend.sh           # Unix
# or
powershell -File scripts/build-backend.ps1   # Windows
```

Then copy the output into Tauri's sidecar directory:

```bash
mkdir -p apps/desktop/src-tauri/binaries
cp apps/backend/dist/lifescribe-backend apps/desktop/src-tauri/binaries/lifescribe-backend-$(rustc -vV | awk '/host/{print $2}')
```

On Windows, append `.exe` to the copy target.

## Run

```bash
bash scripts/dev.sh            # full desktop app
bash scripts/dev.sh backend-only
bash scripts/dev.sh frontend-only
```

## Tests

```bash
cd apps/backend && uv run pytest
cd apps/desktop && npm test
```
```

`docs/dev/adding-a-note-type.md`:

```markdown
# Adding a new note type

1. Define a Pydantic model in `apps/backend/src/lifescribe/vault/schemas.py` that extends `_NoteBase` (plus `_ProvenanceMixin` if the note carries provenance). Declare a `Literal` for `type` and a `model_validator` enforcing the id prefix.
2. Add the new type to the `Note` discriminated union.
3. Add a branch to `_relative_path_for` in `store.py` that returns the correct on-disk path.
4. Add a Pydantic round-trip test in `apps/backend/tests/test_schemas.py`.
5. Add a `VaultStore.write_note` integration test covering a typical write path.
6. Regenerate shared TS types: `bash scripts/gen-types.sh`.
7. Document the type in `docs/user/` if user-facing.
```

- [ ] **Step 3: Commit**

```bash
git add docs/user docs/dev
git commit -m "docs: user install + developer architecture/setup/extension guides"
```

---

## Final verification

- [ ] **Step 1: Run the whole backend suite locally**

```bash
cd apps/backend && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -v
```

Expected: green across the board.

- [ ] **Step 2: Run the whole frontend suite locally**

```bash
cd apps/desktop && npm run typecheck && npm run lint && npm run format:check && npm test -- --run
```

Expected: green.

- [ ] **Step 3: Run Rust lints**

```bash
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

Expected: clean.

- [ ] **Step 4: Build the backend binary, copy into sidecar dir, and launch the Tauri app**

```bash
bash scripts/build-backend.sh
mkdir -p apps/desktop/src-tauri/binaries
HOST_TRIPLE=$(rustc -vV | awk '/host/{print $2}')
cp apps/backend/dist/lifescribe-backend apps/desktop/src-tauri/binaries/lifescribe-backend-${HOST_TRIPLE}
bash scripts/dev.sh
```

Expected: the Tauri window opens, shows the first-run wizard, you can pick an empty directory, click **Create new vault**, and the empty-vault screen appears showing a real `VaultManifestDTO` from disk.

- [ ] **Step 5: Push and confirm CI green on all three OSes**

```bash
git push origin main
```

Expected: all three CI jobs pass on GitHub Actions.

---

## Self-Review Results

**Spec coverage check** — each spec section mapped to at least one task:
- §3 Tech stack → Tasks 3, 15 (backend scaffold + Tauri scaffold)
- §4 Monorepo layout → Tasks 3, 15, 17 (created throughout)
- §5 Vault disk layout → Task 8 (VaultStore.init)
- §6 Note types (v1) → Task 5 (schemas)
- §7 Frontmatter schema → Tasks 5, 6 (schemas + serialization)
- §8 Canonical ID scheme → Task 4 (ids.py)
- §9 Git semantics → Tasks 7, 8, 9, 10 (gitwrap + store commits + hand-edit conflict routing)
- §10 Vault init/open flow → Tasks 8, 13, 19 (backend init/open + API routes + UI wizard)
- §11 VaultStore API → Tasks 8, 9, 10, 11 (every listed method implemented)
- §12 Schema migration framework → Task 11
- §13 Testing & CI → Task 2 (CI matrix) + Task 21 (integration test) + per-task unit tests
- §14 Deliverables → covered across tasks; wizard (19), binary build (14), sidecar launcher (16), docs (22)
- §15 Non-goals → no tasks add anything outside the listed non-goals

**Placeholder scan** — no TBD/TODO/fill-in-details/add-appropriate-X markers in steps. The one intentional `<TODO: maintainer email>` in `CODE_OF_CONDUCT.md` Step 3 is explicitly flagged as "leave the placeholder; the owner will set it before release" and is not a code placeholder.

**Type / name consistency check** — spot checks:
- `VaultStore.init(path, *, app_version)` used consistently across Tasks 8, 9, 10, 11, 13, 21.
- `write_note(note, *, body, commit_message)` signature consistent between Task 9 implementation and later callers.
- `WriteResult.conflict` referenced in Tasks 9, 10, 21 and defined in Task 9.
- ID prefixes (`src_`, `doc_`, `conn_`, `job_`, `vault_`) are consistent between `schemas.py` validators (Task 5) and spec §8.
- `backend_info` Rust command name matches the JS `invoke<BackendReady>("backend_info")` call (Tasks 16 vs 18).
- `VaultStatusDTO` / `VaultManifestDTO` names consistent between `shared-types/src/index.ts` stub (Task 17) and `App.tsx` / `EmptyVault.tsx` usage (Task 19).

**Plan ready for execution.**
