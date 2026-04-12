# LifeScribe Vault Detailed Product Plan

## Summary
Build **LifeScribe Vault** as a **local-first personal data operating system**: a desktop app that ingests files and service exports, normalizes them into a **Git-backed Obsidian vault**, supports **private LLM chat and retrieval**, and later publishes structured subsets of that data to LifeScribe and other destinations through a stable adapter layer.

The product should be designed around one core principle: the **vault is the human-readable system of record**. Everything else, including embeddings, search indexes, sync state, and publish mappings, is secondary and rebuildable. This keeps the app durable, portable, inspectable, and future-proof.

## Refined Product Model
### Core product pillars
- **Capture**: bring in personal data from local files, manual exports, watched folders, and live connectors.
- **Structure**: convert unstructured inputs into canonical notes, entities, events, relationships, and domain summaries.
- **Trust**: preserve provenance, confidence scores, source history, and conflict detection so users can verify what is true.
- **Explore**: browse the vault through dashboard views, Obsidian directly, and LLM chat with citations.
- **Publish**: map canonical vault data into destination-specific schemas for LifeScribe and future services.
- **Evolve**: support schema versioning, plugin-like connectors, and destination adapters without changing the core vault model.

### Product positioning
- Not just a document uploader
- Not just a RAG chat app
- Not just an Obsidian plugin
- It is a **local personal knowledge and data integration platform** with Obsidian as the durable storage layer

## Refined Feature Set
### 1. Ingestion and import features
- Multi-file drag-and-drop import for PDF, TXT, MD, DOCX, XLS/XLSX, CSV, HTML, JSON, images, ZIP export bundles
- Folder import for bulk migration from old archives
- Watched folders for automatic pickup of new documents or export files
- Manual export import wizard with service-specific instructions
- Import presets by data type:
  - documents
  - finance exports
  - email exports
  - calendar exports
  - contacts
  - social exports
  - photos/media
  - browser/history/bookmarks
- Import job queue with pause, resume, retry, cancel
- Duplicate detection using hash + fuzzy text similarity
- Incremental re-import when the same source changes
- File fingerprinting so the app knows whether a source has already been processed

### 2. Parsing and enrichment features
- Text extraction from native digital documents
- OCR fallback for scanned PDFs and image-heavy files
- Table extraction from spreadsheets and tabular PDFs
- Metadata extraction:
  - creation/modification dates
  - authors
  - file paths
  - EXIF/media metadata
  - detected language
  - source service/account
- Entity extraction:
  - people
  - organizations
  - locations
  - products
  - accounts
  - projects
  - events
  - communication channels
- Temporal enrichment:
  - exact dates
  - date ranges
  - inferred sequence ordering when dates are partial
- Topic tagging and domain classification
- Relationship inference:
  - person to event
  - account to document
  - trip to receipts/photos/reservations
  - job to emails/contracts/pay slips
- Summary generation at multiple levels:
  - file summary
  - source bundle summary
  - domain summary
  - person dossier
  - timeline segment summary

### 3. Vault generation features
- Deterministic note generation so repeated imports yield stable file paths
- Human-readable Markdown notes with frontmatter and evidence links
- Asset copy/store strategy for images, PDFs, and attachments
- Bi-directional internal links between notes
- Dedicated note templates for:
  - source records
  - entities
  - events
  - accounts
  - places
  - domain collections
  - summaries
- Automatic index pages:
  - source index
  - people index
  - places index
  - timeline index
  - connector index
  - publish history index
- Change log notes for each import run
- Conflict notes when imported data disagrees with existing facts

### 4. Dashboard features
- Home dashboard with vault health, recent imports, pending reviews, publish status
- Import center for files, folders, exports, and watched paths
- Connector catalog and setup center
- Job history and logs
- Search and browse views for entities, events, documents, and domains
- Review queue for low-confidence or conflicting extractions
- Publish center for destination setup, dry-run, and delivery logs
- Settings for vault location, AI providers, parser defaults, privacy modes, backup
- Diagnostics page for parser availability, OCR status, local model health, disk usage

### 5. LLM chat and retrieval features
- Chat with vault using citations back to exact notes/assets
- Query modes:
  - factual answer
  - timeline reconstruction
  - person dossier
  - compare/contrast sources
  - summarize a life domain
  - prepare data for export
- Answer grounding rules:
  - always cite source notes
  - expose confidence
  - separate fact from inference
- Structured query output options:
  - Markdown
  - JSON
  - CSV
- Saved prompts and reusable query templates
- Optional local agent workflows:
  - “build a timeline from these sources”
  - “prepare a profile for this person”
  - “find contradictions in my travel history”

### 6. Publishing features
- Publish dry-run before any destination write
- Mapping UI from canonical vault fields to destination-specific fields
- Destination-specific validation errors with repair suggestions
- Publish profiles:
  - full sync
  - one-way append
  - selected note types only
  - one-time export snapshot
- Publish receipts stored in vault/system records
- Idempotent publish tokens to prevent duplicate remote writes
- Future support for reverse sync status and conflict detection
- Bulk export modes:
  - JSON package
  - Markdown package
  - CSV tables
  - API push
  - MCP-mediated push

### 7. Privacy, governance, and trust features
- Per-source privacy labels:
  - private
  - shareable
  - publishable
  - restricted
- Redaction rules for sensitive fields before publish/chat
- Local encryption option for sensitive caches and credentials
- Source provenance on every derived note
- Confidence scoring per extracted field or assertion
- Merge review for duplicate entities
- Audit trail for imports, edits, and publishes
- Optional “never send to cloud” mode enforced in settings

## Recommended Vault Design
### Folder model
- `/00_inbox` raw unreviewed intake summaries
- `/10_sources` provenance-first source notes and manifests
- `/20_entities` people, orgs, places, accounts, devices, projects
- `/30_events` canonical dated/undated life events
- `/40_domains` finance, health, travel, work, education, media, social, legal, home
- `/50_summaries` generated rollups and dossiers
- `/60_publish` export profiles, publish receipts, destination mappings
- `/assets` original files, derived images, thumbnails, attachments
- `/system` schemas, connector definitions, logs, indexes, migration records

### Canonical note types
- `SourceRecord`
- `DocumentRecord`
- `EntityRecord`
- `EventRecord`
- `RelationshipRecord`
- `DomainRecord`
- `SummaryRecord`
- `PublishReceipt`
- `ConnectorRecord`

### Frontmatter conventions
Each canonical note should include:
- stable id
- type
- source ids
- created/imported timestamps
- confidence
- privacy label
- tags/domain
- linked entities/events
- parser/enricher version
- evidence refs

## Detailed Architecture
### App stack
- **Desktop shell**: Tauri
- **Frontend**: React or Svelte dashboard
- **Backend runtime**: Python
- **Local DB sidecar**: SQLite for job state, connector config, sync cursors, cached metadata
- **Vault storage**: Obsidian-compatible Markdown + assets on disk
- **Search layer**: SQLite FTS for lexical search plus optional vector sidecar
- **Model serving**: Ollama by default for local LLMs
- **Optional vector DB**: Qdrant only if needed beyond SQLite-based retrieval

### Why this stack
- Python has the strongest open-source ecosystem for OCR, parsing, ETL, and enrichment
- Tauri keeps the desktop app lightweight and local
- SQLite is enough for runtime state and avoids overengineering
- Obsidian vault stays portable and visible to the user
- The sidecar pattern keeps indexes rebuildable and disposable

### Services and boundaries
- `IngestionService`
  - accepts imports from UI and connectors
  - creates source manifests and jobs
- `ExtractionService`
  - routes files through parsers/OCR/table extractors
- `NormalizationService`
  - converts extracted content to canonical objects
- `VaultWriter`
  - writes notes, links, assets, indexes, receipts
- `SearchService`
  - lexical + semantic retrieval over canonical notes
- `ChatService`
  - grounded answers with citations
- `ConnectorService`
  - connector catalog, auth state, sync jobs, manual-export recipes
- `PublisherService`
  - destination adapters, validation, receipts, retry queue
- `PolicyService`
  - privacy rules, redaction, cloud/local constraints
- `MigrationService`
  - schema upgrades for vault and runtime metadata

## Free/Open-Source Library Recommendations
### Document and file ingestion
- [Docling](https://github.com/docling-project/docling)
  - strong candidate for structured document conversion
- [Unstructured](https://github.com/Unstructured-IO/unstructured)
  - broad support for heterogeneous document ingestion
- [marker](https://github.com/datalab-to/marker)
  - especially good for PDF to Markdown/JSON
- [Tesseract](https://github.com/tesseract-ocr/tessdoc)
  - OCR fallback
- [Pandoc](https://github.com/jgm/pandoc)
  - document format conversion
- [pandas](https://github.com/pandas-dev/pandas)
  - tabular normalization and CSV/XLS handling
- [openpyxl](https://github.com/ericgazoni/openpyxl)
  - direct Excel workbook handling
- [python-docx](https://github.com/python-openxml/python-docx)
  - DOCX parsing if needed as a focused utility
- [ExifTool](https://github.com/exiftool/exiftool)
  - media metadata extraction

### Connectors and ETL patterns
- [Meltano](https://github.com/meltano/meltano)
  - best reference system for managing connector catalogs and Singer taps
- [Singer taps/targets](https://github.com/singer-io)
  - reusable extractor ecosystem
- [dlt](https://github.com/dlt-hub/dlt)
  - simpler programmable ingestion pipelines
- [Airbyte](https://github.com/airbytehq/airbyte)
  - useful for connector patterns and selective reuse, but likely too heavy as the embedded core
- [public-apis](https://github.com/public-apis/public-apis)
  - discovery index only
- `scrapecreators.com`
  - useful as research input for social scraping/import possibilities, but should be treated as optional and reviewed service-by-service before adoption

### Retrieval, chat, and indexing
- [Ollama](https://github.com/ollama/ollama)
  - local model runtime
- [LlamaIndex](https://github.com/run-llama/llama_index)
  - strong fit for retrieval, document indexing, and citation workflows
- [LangGraph](https://github.com/langchain-ai/langgraph)
  - useful if you want richer agent workflows later
- [Qdrant](https://github.com/qdrant/qdrant)
  - optional vector retrieval layer
- SQLite FTS
  - likely enough for v1 lexical search and low-complexity local retrieval

### Vault interoperability
- [mcp-obsidian](https://github.com/bitbonsai/mcp-obsidian)
  - best fit for safe AI access to vault notes
- [basic-memory](https://github.com/basicmachines-co/basic-memory)
  - useful design reference for markdown-native memory systems

### Local app and orchestration
- [Tauri](https://github.com/tauri-apps/tauri)
- [watchfiles](https://github.com/samuelcolvin/watchfiles)
- Git as a native dependency for versioned vault snapshots

## Refined Connector Strategy
### Connector types
- `FileConnector`
  - direct file/folder ingestion from local disk
- `ManualExportConnector`
  - user downloads export from a service, then imports it
- `APISyncConnector`
  - OAuth/API-based sync for services where free practical access exists
- `WatchFolderConnector`
  - monitored directory for recurring drops
- `BridgeConnector`
  - future import from other local apps or MCP sources

### Connector catalog metadata
Each connector should store:
- service name
- category/domain
- official site/docs
- data types available
- import modes supported
- auth type
- free/paid note
- export instructions
- sample files
- parser availability
- data freshness expectations
- reliability score
- current implementation status

### Recommended v1 connector families
- local documents and folders
- Google Takeout-like exports
- calendar ICS/CSV exports
- contacts vCard/CSV exports
- email MBOX/EML exports
- social platform export ZIPs
- bank/budget CSV exports
- photo library folders with EXIF
- browser bookmark/history exports
- note app markdown/text exports

### Recommended v2 connector families
- live Google/Microsoft APIs
- messaging platforms with supported exports/APIs
- cloud drive connectors
- wearable/health data exports
- travel/reservation providers
- e-commerce and receipts
- CRM/newsletter/social creator tools

## Refined Publishing Strategy
### Recommended design
Do **not** publish directly from raw notes. Publish from **canonical objects** only.

### Publishing pipeline
- select canonical objects from vault
- validate against destination contract
- apply privacy/redaction policy
- map fields to destination schema
- run dry-run preview
- execute publish
- persist receipt and remote ids
- support retries and idempotency

### LifeScribe recommendation
Because there is no stable public API to plan against, define a **LifeScribe destination contract** now:
- profile/person records
- timeline entries
- media items
- relationship links
- domain-specific structured sections
- source attribution metadata

Then support three future delivery paths with the same internal contract:
- direct REST/GraphQL API adapter
- signed JSON import package
- MCP-mediated write operations

### MCP recommendation
Yes, MCP is worth planning for, but as a **bridge**, not the only integration path.
- Build an MCP server for LifeScribe Vault if you want AI tools to inspect and manipulate vault data safely
- Build an MCP surface for `lifescribe.us` only if you want agent-driven workflows to create/update records there
- Keep direct API adapters available for normal app-to-app publishing because they are more predictable for production sync

## Recommended Feature Refinements
### Most important refinements
- Add a **review queue** early. Personal-data extraction will create ambiguity, and users need a trust layer.
- Add **provenance and evidence links** to every derived summary. This is essential for credibility.
- Add **privacy policy controls** before publishing and cloud-model support. This will matter immediately.
- Add **connector recipes** even before full connectors. A good manual-import experience is more valuable than a half-working OAuth integration.
- Add **deterministic canonical IDs** so entities and events stay stable across re-imports.
- Add **schema migration support** from day one. Vault structures evolve quickly in products like this.

### Features to avoid in v1
- Full bidirectional sync with many live SaaS services
- Complex multi-user collaboration
- Heavy always-on background agents
- Automatic fact resolution without user review
- Destination-specific custom logic embedded in the core vault writer

## Suggested Delivery Phases
### Phase 1: Foundation
- local desktop shell
- vault initialization and folder structure
- file import pipeline
- source manifests and ingestion logs
- markdown note generation
- basic search and browse
- manual export connector catalog

### Phase 2: Intelligence
- OCR and table extraction
- entity/event normalization
- summaries and timeline views
- local LLM chat with citations
- duplicate detection and review queue

### Phase 3: Connectors
- connector recipes with guided imports
- watched folders
- first live API connectors where practical
- connector sync state and re-import

### Phase 4: Publishing
- canonical publish contracts
- LifeScribe adapter stub
- dry-run mapping UI
- publish receipts and retry queue
- optional MCP bridge

### Phase 5: Maturity
- privacy/redaction profiles
- schema migrations
- backup/restore UI
- advanced audits and health checks
- plugin-like extension model for connectors/publishers

## Test Plan
### Functional scenarios
- import mixed local documents
- import a ZIP-based service export
- re-import the same source without duplicate note explosions
- detect and queue low-confidence extractions for review
- generate entity, event, and summary notes with provenance
- answer a chat query with exact citations
- publish a dry-run export for a selected destination
- apply privacy rules that remove restricted fields before publish

### Edge cases
- scanned PDF with no embedded text
- duplicate files with different filenames
- conflicting dates across multiple sources
- partial imports where one parser fails
- malformed export bundles
- large asset folders
- offline operation with no cloud access
- schema upgrade on an existing vault

### Acceptance criteria
- vault remains readable in plain Obsidian without the app
- every generated fact can be traced back to source evidence
- chat answers never rely on uncited hidden state
- repeated imports are idempotent
- publish actions are auditable and recoverable
- app is useful even with manual exports only

## Assumptions and defaults
- Desktop-first local app
- Python runtime + Tauri shell
- Obsidian vault is the long-term source of truth
- SQLite stores runtime state only
- Local-first AI with Ollama by default
- Connector v1 emphasizes manual exports and file imports
- MCP is additive, not mandatory for core functionality
- LifeScribe publishing starts from a stable internal contract, not a hardcoded API dependency
