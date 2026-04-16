# File Drop Connector

The reference LifeScribe connector. Accepts PDF / TXT / MD / PNG / JPG files via the import UI and writes one `SourceRecord` per unique file into the vault.

This connector wraps `lifescribe.ingest.extractors` — each supported MIME type is handled by the corresponding extractor. To add a new file type, register an extractor in `apps/backend/src/lifescribe/ingest/extractors/` rather than editing this connector.
