# LifeScribe Vault — Overview Spec

**Date:** 2026-04-12
**Status:** Approved
**Type:** Umbrella / architecture overview (not an implementation spec)

## 1. Purpose & scope of this document

This document is the **umbrella spec** for LifeScribe Vault. It is not an
implementation spec and is not sufficient by itself to write code from.

Its job is to:

- Define the seven sub-projects the app decomposes into.
- Fix the build order and milestones.
- Enumerate cross-cutting invariants every sub-project spec must honor.
- Record which decisions are deliberately deferred to which sub-spec.
- Provide a shared glossary and reference list.

Each sub-project gets its own spec in this directory, which cites this
document by name. If an invariant here conflicts with a later sub-spec, the
conflict must be resolved by updating this document — not by letting a
sub-spec drift.

## 2. Product vision

LifeScribe Vault is a local-first, open-source desktop app that aggregates a
person's data — from local files and from third-party services — into an
Obsidian-compatible Markdown vault. The vault is the **human-readable
system of record**; all other state (SQLite, search indexes, embeddings,
sync cursors) is rebuildable from it.

The app supports four primary verbs over the vault:

- **Capture** — bring data in from files and services.
- **Structure** — convert raw inputs into canonical notes with provenance.
- **Explore** — browse in the dashboard, in Obsidian directly, or via LLM chat.
- **Publish** — push canonical subsets of the vault to destinations (LifeScribe first; others later) through a pluggable publisher interface.

## 3. Sub-project decomposition

LifeScribe Vault is delivered as seven sub-projects, each with its own
spec → plan → implementation cycle.

### 3.1 Vault Foundation
Defines the durable data contract: disk layout, note types, frontmatter
schema, deterministic canonical IDs, schema-version header, git semantics,
vault init/open, and the read/write primitives other sub-projects call
into. Also: tech stack selection, license confirmation, project scaffolding.

### 3.2 Ingestion Pipeline
Local file upload and conversion. Parses PDFs, DOCX, XLS/CSV, TXT, MD,
HTML, JSON, images, and ZIP export bundles. Includes OCR fallback, metadata
extraction, canonical note generation, idempotent re-imports, and an
ingestion log. Delivers the first end-to-end "it works" experience.

### 3.3 Dashboard Shell
The desktop app shell. Settings (vault path, provider config, privacy
master switch), import center UI, ingestion log view, basic browse. Sized
to be the minimum UI that makes sub-projects 3.1 and 3.2 usable, and
designed so later sub-projects plug sections into it rather than forcing
rewrites.

### 3.4 LLM Provider Framework
An OpenAI-compatible provider abstraction. Ships with built-in entries for
Ollama, LM Studio, GitHub Models (leveraging Copilot Pro subscriptions via
`models.github.ai`), OpenAI, and Anthropic. Includes a "never leave the
machine" master switch enforced at the transport layer. Extensible by
third-party contributors via the same interface built-ins use.

### 3.5 Chat with Vault
Retrieval + grounded chat with citation back to exact notes and assets.
Starts with SQLite FTS for lexical retrieval; vector sidecar deferred
until evaluation shows need. Consumes 3.1, 3.2, 3.4.

### 3.6 Connector Framework + Catalog
Pluggable connector interface covering five types: `FileConnector`,
`ManualExportConnector`, `APISyncConnector`, `WatchFolderConnector`,
`BridgeConnector`. Includes a connector catalog with metadata (service,
category, auth mode, free/paid, export instructions, sample files) and a
small set of v1 connectors. Designed as the primary OSS contribution
surface.

### 3.7 Publishing Framework
Canonical-to-destination publisher interface with dry-run, mapping UI,
privacy-label enforcement, publish receipts, and idempotent retries.
Includes a LifeScribe destination contract (no live API dependency yet)
and an optional MCP bridge.

### Out of scope for v1

Deliberately deferred beyond the seven sub-projects:

- Entity / event / relationship extraction and inference
- Review queue for low-confidence extractions
- Summary rollups (file / source / domain / person / timeline)
- Agent workflows ("build a timeline from these sources")
- Bidirectional / reverse sync from publish destinations
- Multi-user collaboration
- Plugin marketplace

These are real features — and the Codex plan covers them thoughtfully — but
they belong to a v2 "Intelligence" track. v1 proves the foundation.

## 4. Build order & milestones

```
1. Vault Foundation
        │
        ├──► 2. Ingestion Pipeline
        │            │
        │            ▼
        └──► 3. Dashboard Shell ──► M1: usable end-to-end
                     │
                     ├──► 4. LLM Provider Framework
                     │            │
                     │            ▼
                     │        5. Chat with Vault
                     │
                     ├──► 6. Connector Framework + Catalog
                     │
                     └──► 7. Publishing Framework (+ MCP bridge)
```

**Sequencing rules**

- 3.1 → 3.2 → 3.3 is strictly serial.
- After 3.3, sub-projects 3.4, 3.6, 3.7 are independent and may be worked
  in any order or in parallel by different contributors.
- 3.5 depends on 3.4 and should follow it.
- The dashboard (3.3) is designed to accept new sections (chat pane,
  connector catalog, publish center) without a rewrite.

**Milestones**

| Milestone | Scope | Theme |
|---|---|---|
| **M1 (v0.1)** | 3.1 + 3.2 + 3.3 | "Local files → vault → browse." Shippable OSS alpha. |
| **M2 (v0.2)** | + 3.4 + 3.5 | "Chat with your vault." |
| **M3 (v0.3)** | + 3.6 | "Pull from services." |
| **M4 (v1.0)** | + 3.7 | "Publish to LifeScribe / MCP." |

## 5. Cross-cutting invariants

Every sub-project spec must honor these. They are the load-bearing
promises of the project.

### Data

1. **Vault is the system of record.** Markdown and assets on disk are
   authoritative. SQLite, indexes, embeddings, and caches are rebuildable
   from the vault. No fact is stored only in a sidecar.
2. **Every derived fact carries provenance.** Source id, evidence link,
   extractor name and version, extraction timestamp, and confidence
   score. No unsourced assertions.
3. **Deterministic canonical IDs.** Re-importing the same source twice
   produces the same IDs and the same file paths. Imports are idempotent
   by construction.
4. **Schema-versioned frontmatter.** Every note declares its
   `schema_version`. Migrations are explicit, versioned, and replayable.
5. **Hand-edit safety.** The app never silently overwrites user edits.
   If a note was hand-modified after the last app write, the app writes
   to a sibling conflict file and logs it.

### Privacy

6. **Local-first by default.** No outbound network calls without
   explicit user configuration.
7. **"Never leave the machine" master switch.** When enabled, the
   transport layer blocks all non-localhost destinations. Providers,
   connectors, and publishers all respect it.
8. **Per-source privacy labels** — `private`, `shareable`,
   `publishable`, `restricted` — enforced at publish time.

### Extensibility (OSS-first)

9. **Three clean extension points:** providers (LLM), connectors
   (inbound), publishers (outbound). Each is an interface plus a
   registry; built-ins use the same interface third-party contributors
   would.
10. **No hidden coupling between subsystems.** A connector cannot
    import from the publisher; chat cannot reach into ingestion
    internals. Cross-subsystem communication goes through the vault
    or through typed service APIs only.
11. **Cross-platform from day one.** Windows, macOS, Linux. No
    platform-specific paths, shell calls, or binaries without
    documented fallbacks.

### Operational

12. **Git-backed vault.** The app initializes the vault as a git repo.
    One commit per ingestion job, with structured messages. Users can
    inspect and roll back with standard git tooling.
13. **Everything is inspectable in plain Obsidian.** The vault remains
    fully usable if the app is uninstalled. No app-only magic.
14. **Structured logs + audit trail** for every import, edit, and
    publish action, stored in `/system/logs/` as Markdown.

### Quality

15. **Each sub-project ships with tests** (unit plus at least one
    integration scenario) and user-facing docs before it is considered
    done.
16. **License: MIT.** `LICENSE`, `README`, `CONTRIBUTING`,
    `CODE_OF_CONDUCT`, and issue/PR templates present from the start.
17. **No telemetry, ever.** No phone-home, no anonymous metrics, no
    background crash reporting. Any diagnostic upload requires explicit
    per-event user consent.

## 6. Deferred decisions

These are recorded here so we don't re-litigate. Each is decided in the
listed sub-spec with real constraints in hand.

| Decision | Decided in |
|---|---|
| Tech stack (desktop shell, backend language, UI framework) | Vault Foundation |
| Vault folder model (concrete folders + note type names) | Vault Foundation |
| Frontmatter field set | Vault Foundation |
| OCR engine | Ingestion Pipeline |
| Parser library choices (Docling / Unstructured / marker / pandoc / etc.) | Ingestion Pipeline |
| Retrieval approach (FTS-only vs FTS + vectors, and when) | Chat with Vault |
| Connector catalog data format | Connector Framework |
| First v1 connector set | Connector Framework |
| Publish transport (direct API / JSON package / MCP) ordering | Publishing Framework |
| MCP server design for the vault itself | Publishing Framework (or own side-spec) |

The Codex plan's library shortlists and folder proposals are inputs to
these decisions, not the decisions themselves.

## 7. Glossary

- **Vault** — The on-disk Markdown + assets tree. Obsidian-compatible.
  The authoritative store of all facts.
- **Canonical note** — A note that follows the app's note-type schema
  (type, id, frontmatter, evidence links). Distinct from free-form
  user notes.
- **Canonical ID** — A deterministic identifier for an entity, event,
  source, or document, derived from content so the same input always
  produces the same id.
- **Provenance** — The chain of evidence behind a derived fact: source
  id, extractor name and version, extraction timestamp, confidence.
- **Sidecar** — Any non-vault storage (SQLite, vector index, cache).
  Always rebuildable from the vault.
- **Provider** — An LLM backend accessed through the OpenAI-compatible
  provider interface (Ollama, LM Studio, GitHub Models, OpenAI,
  Anthropic, …).
- **Connector** — An inbound adapter that brings data from a source
  into the vault.
- **Publisher** — An outbound adapter that pushes canonical vault data
  to an external destination.
- **Schema version** — The explicit version tag on a note's
  frontmatter; controls migration behavior.

## 8. References

- **Project inputs (repo root)**
  - `requirements.md` — original requirements document
  - `codex_plan.md` — Codex-generated plan, used as input research
- **External**
  - karpathy's Obsidian vault gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
  - public-apis index: https://github.com/public-apis/public-apis
  - Model Context Protocol: https://modelcontextprotocol.io
  - GitHub Models: https://docs.github.com/en/github-models
