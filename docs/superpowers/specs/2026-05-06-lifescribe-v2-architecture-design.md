# LifeScribe Vault v2 Architecture Design

**Date:** 2026-05-06
**Status:** Draft for user review
**Type:** Architecture decision and v2 direction
**Build decision:** Iterate on the existing app

## 1. Purpose

This spec records the v2 direction for LifeScribe Vault after reviewing the current app, the two Claude research notes, and the latest product goals.

The key decision is to continue from the existing Tauri + React + Python/FastAPI app rather than starting over. The current app already has the hard foundation: a local-first desktop shell, Obsidian-compatible Markdown vault, Git-backed storage, document ingestion, provider abstraction, privacy mode, chat with citations, and a pluggable connector framework. V2 should add stronger ingestion, service imports, generated life-wiki structure, and publishing rather than rebuild solved infrastructure.

## 2. Design Goals

V2 keeps the original product identity:

- The vault remains the human-readable system of record.
- Imported source notes, user-authored notes, generated life-wiki notes, indexes, and publish records stay clearly separated.
- All generated facts carry provenance back to source material.
- Local-first operation remains the default.
- No cloud model, cloud connector, scraper, or publisher runs without explicit user configuration.
- The app remains useful without Obsidian installed, but everything it writes remains inspectable in Obsidian.

V2 is not trying to prioritize a single differentiator. It should become a more complete personal data system: import, normalize, browse, chat, compile, review, and eventually publish.

## 3. Continue Existing App

### Decision

LifeScribe Vault v2 will iterate on the existing app.

### Rationale

The current app already matches the intended architecture:

- Tauri desktop app with local Python/FastAPI sidecar.
- React dashboard for import, browse, chat, logs, and settings.
- Git-backed Markdown vault with YAML frontmatter.
- SQLite FTS search as a rebuildable sidecar.
- LLM provider abstraction for local and cloud models.
- Connector catalog based on `connectors/<service>/manifest.toml`.
- Privacy labels and a "never leave the machine" policy boundary.

Starting over would mostly recreate these boundaries. The v2 risks are better handled through incremental modules: ingestion engine routing, export-specific connectors, canonical life notes, wiki compilation, review flows, and publishing.

### When a rewrite would be justified

A new app would only make sense if the product direction changed to a hosted multi-user SaaS, a web-only collaboration platform, or an Obsidian-plugin-only experience. Those are different products from the current local-first LifeScribe Vault.

## 4. Application Shape

The Tauri desktop app remains the primary control center.

Obsidian remains the preferred human editor and reader for the vault, but it should not be required for core operation. An Obsidian companion plugin can be added later after the backend and vault contracts are stable.

Recommended surfaces:

- **Desktop app:** import center, connector setup, provider settings, chat, logs, review queue, diagnostics, publisher setup.
- **Obsidian vault:** direct editing, reading, graph exploration, generated wiki pages, manual autobiography notes.
- **Optional Obsidian plugin:** commands that call the LifeScribe backend, such as recompile current note, ask about current note, set privacy label, open provenance, and launch imports.
- **Future MCP server:** controlled agent access to vault search, note reads, allowed note writes, compile jobs, and publish dry-runs.

## 5. Vault Layers

The vault should distinguish five classes of content:

1. **Raw assets:** original PDFs, ZIP exports, images, spreadsheets, and attachments under `assets/`.
2. **Source records:** imported source notes under `10_sources/`, preserving extraction output and provenance.
3. **User-authored autobiography notes:** user-written notes outside generated sections or in a dedicated personal notes area.
4. **Canonical life records:** structured entities, events, relationships, domains, and summaries.
5. **Compiled life wiki:** LLM-maintained Markdown pages that synthesize source-backed facts into readable life narratives, timelines, and dossiers.

Suggested folders:

```text
00_inbox/
10_sources/
20_entities/
30_events/
40_domains/
50_summaries/
55_life_wiki/
60_publish/
70_chats/
assets/
system/
```

The compiled wiki is valuable, but it is not primary evidence. Source records and canonical notes remain the authority for citations and publish decisions.

## 6. Ingestion Engine Router

### Decision

Use Docling as the primary document conversion engine for v2. Keep MarkItDown as a backup/fallback engine and as coverage for formats Docling does not handle well enough.

### Rationale

Docling is the better primary fit for structured ingestion because it focuses on high-quality document parsing and exports structured results that can feed canonical records, chunking, and future enrichment. MarkItDown remains useful because it is lightweight, broad, Markdown-first, and likely to cover edge formats or quick fallback paths.

### Engine routing model

Add an ingestion engine abstraction instead of hardcoding one extractor per file type:

```text
Import request
  -> MIME/type detection
  -> engine policy
  -> Docling primary conversion
  -> MarkItDown fallback when configured or needed
  -> existing native extractor fallback for simple/stable formats
  -> normalized ExtractionResult
  -> SourceRecord / DocumentRecord write
```

The first engine router should support:

- Engine selection by MIME type, file extension, file size, and user setting.
- Per-engine confidence and warning metadata.
- Source preservation even when rich extraction partially fails.
- Re-running a source through a different engine without losing the original source record.
- Test fixtures comparing Docling, MarkItDown, and current native output for representative files.

### Tool policy

- **Docling:** bundled primary dependency if packaging size and install stability are acceptable.
- **MarkItDown:** bundled or optional dependency depending on package impact; used as fallback and extra-format support.
- **marker:** not bundled by default because of GPL/commercial licensing concerns; may be supported as an external user-installed engine later.
- **Synthadoc:** not embedded; methodology reference only.

## 7. Third-Party Data Imports

### Import order

Start with manual export connectors, then API connectors, then scraper-backed connectors only when appropriate.

Manual exports are the best first path because they are free, local, auditable, and aligned with privacy mode. For social platforms, official account exports usually contain richer personal data than public APIs or scrapers.

### Connector classes

The existing connector framework remains the extension point. V2 should add concrete implementations for:

- `ManualExportConnector`: ZIP/folder/file exports from services.
- `APISyncConnector`: OAuth/API import where useful and available.
- `WatchFolderConnector`: automatically process new export files dropped into watched folders.
- `BridgeConnector`: delegate to external tools or local helper services when a connector cannot safely be bundled.

### First connector candidates

Recommended first wave:

- Facebook export ZIP.
- Instagram export ZIP.
- Google Takeout starter subset, such as calendar, contacts, location history if available, photos metadata, and bookmarks.
- Browser bookmarks/history import.
- Generic CSV/JSON folder import for user-provided structured data.

ScrapeCreators, WebScraper.io, Apify-style actors, and similar services should be cataloged as optional network connectors, not core defaults. They can be useful, but they add cost, fragility, and service-policy risk.

## 8. Canonical Life Model

V2 should introduce canonical records gradually. The initial record types should be:

- `PersonRecord`
- `PlaceRecord`
- `OrganizationRecord`
- `AccountRecord`
- `EventRecord`
- `RelationshipRecord`
- `DomainRecord`
- `LifePeriodRecord`
- `SummaryRecord`
- `ContradictionRecord`
- `OpenQuestionRecord`
- `PublishReceipt`

Each generated or normalized record must include:

- Stable deterministic ID.
- Schema version.
- Source IDs.
- Evidence references.
- Extractor or compiler version.
- Confidence.
- Privacy label.
- Last generated timestamp.
- Hand-edit safety marker.

This model should be built in slices. V2 should not attempt complete entity/event intelligence in the first implementation pass.

## 9. Life Wiki Compiler

### Decision

Implement a LifeScribe-native compiler inspired by Karpathy's LLM wiki pattern, Synthadoc, and Foundry Vault. Do not embed Synthadoc as a dependency.

### Purpose

The compiler turns source-backed canonical records into readable, interlinked Markdown pages. It is a persistent, compounding artifact, not just query-time RAG.

### Compiler jobs

Initial jobs:

- Compile a person page from linked sources and events.
- Compile a place page from visits, addresses, photos, and references.
- Compile a timeline page by year/month/life period.
- Compile a domain summary, such as work, education, travel, health, finances, family, or projects.
- Compile an open questions page for missing or ambiguous information.
- Compile a contradictions page for conflicting dates, names, locations, or claims.

### Rules

- Compiler output must cite source or canonical records.
- Generated wiki pages must be clearly marked as generated.
- User edits must not be overwritten silently.
- If a generated page was hand-edited, recompilation writes a proposed revision or conflict note.
- The compiler must separate facts, inferences, and unknowns.
- The compiler must work with local or cloud LLM providers through the existing provider framework.
- Privacy mode blocks cloud compiler jobs.

## 10. Chat And Retrieval

Keep the existing chat system and extend it.

V2 should support hybrid retrieval over:

- Source records.
- Canonical records.
- Compiled life-wiki pages.
- User-authored notes, if the user opts into including them.
- Prior chat notes, if enabled.

The answer UI must distinguish:

- Direct evidence from imported sources.
- Structured canonical records derived from evidence.
- Generated wiki synthesis.
- User-authored notes.

SQLite FTS remains the baseline because it is simple, local, inspectable, and rebuildable. Add vector retrieval only after a small evaluation harness shows meaningful quality gains for life-history queries.

## 11. Review Queue

V2 needs a review flow before aggressively compiling or publishing data.

Review items should include:

- Low-confidence extractions.
- Conflicting facts.
- Possible duplicate people, places, organizations, accounts, or events.
- Sensitive items marked publishable.
- Unsupported export files.
- Connector warnings.
- Compiler output with weak evidence.

The review queue should live in both the app UI and Markdown under `system/review/` or a similar audit-friendly folder.

## 12. Publishing

Publishing remains last.

Before building a direct lifescribe.us integration, define a versioned publish package:

- Manifest.
- Source/canonical note IDs.
- Destination profile.
- Privacy validation result.
- Dry-run report.
- Payload preview.
- Publish receipt.

The first transport can be a local export package. Direct API, WordPress integration, or MCP-mediated publishing can come after the destination contract exists.

Publishing must use canonical records or reviewed generated records, not raw extracted text alone.

## 13. Error Handling And Diagnostics

V2 should make failures inspectable:

- Every import job records selected engine, fallback path, warnings, and errors.
- Partial extraction writes a source record with clear status instead of disappearing.
- Connector failures include service, account/export context, and next-step guidance.
- Compiler jobs write proposed changes, skipped pages, and unresolved citations.
- Diagnostics show installed engines, Docling health, MarkItDown health, OCR availability, local model availability, vault path health, and privacy-mode blockers.

## 14. Testing Strategy

The first implementation plan should add tests before large rewrites:

- Engine router unit tests.
- Golden-file fixtures for PDF, DOCX, XLSX, CSV, HTML, image, and ZIP inputs.
- Connector contract tests for manual export connectors.
- Privacy-mode tests for Docling/MarkItDown/network connector behavior.
- Canonical record serialization tests.
- Compiler prompt/output validation tests using deterministic fake LLMs.
- End-to-end import-to-wiki smoke test.

## 15. Implementation Slices

The v2 work should be split into separate specs/plans:

1. **Ingestion Engine Router:** Docling primary, MarkItDown fallback, existing extractors retained as fallback.
2. **Manual Export Connector Foundation:** connector UI for choosing service/export, folder/ZIP handling, first service import.
3. **Canonical Life Records:** schema, serialization, IDs, and minimal event/person/place extraction.
4. **Life Wiki Compiler:** generated pages, citations, compile jobs, conflict-safe writes.
5. **Review Queue:** UI and Markdown audit records for low-confidence facts and contradictions.
6. **Hybrid Chat Over Life Layers:** retrieval over source, canonical, wiki, and selected user notes.
7. **Publish Package Framework:** dry-run export package and receipts before any live destination integration.

## 16. Explicit Non-Goals For First V2 Slice

The first v2 slice should not include:

- A rewrite of the Tauri app.
- Obsidian-plugin-only operation.
- Live social API OAuth.
- Scraper-backed imports.
- Direct publishing to lifescribe.us.
- Vector database installation.
- Full autobiography generation.
- Full entity resolution across all imported data.

The first slice should prove that Docling can become the primary ingestion engine without regressing current import behavior.

