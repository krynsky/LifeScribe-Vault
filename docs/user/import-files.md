# Importing files

LifeScribe Vault turns local documents into canonical notes under
`10_sources/` and keeps the originals under `assets/<hash>/`.

## How to import

In the desktop app, open an existing vault, then use the import dialog
(future Dashboard Shell) or call the backend API directly:

```bash
curl -s -X POST http://127.0.0.1:$PORT/ingest/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"files": ["/absolute/path/to/file.pdf"]}'
```

Poll `GET /ingest/jobs/<job_id>` until `status` reaches a terminal
state (`completed`, `completed_with_failures`, `cancelled`, `failed`).

## Supported formats

TXT, MD, JSON, CSV, HTML, PDF, DOCX, XLSX, PPTX, EPUB, and images
(PNG/JPG/GIF/WebP/BMP/TIFF).

## Conversion engines

LifeScribe uses a Docling-first conversion router for rich document
formats such as PDF, DOCX, XLSX, PPTX, EPUB, HTML, and images. If
Docling cannot convert a format that has an existing native extractor,
LifeScribe falls back to the next configured engine for that format.

For routed rich-document imports, each source note records the selected
engine, attempted engines, and conversion warnings in its frontmatter so
import behavior is inspectable later.

## Re-importing the same file

Re-importing a file with identical bytes and the same filename is a
no-op for the affected note (idempotency). The ingestion log still
records the attempt under `skipped_identical`.

## Where things land

- Note: `10_sources/<source_id>.md`
- Original bytes: `assets/<first-2-hex>/<sha256>/<original-filename>`
- Job log: `system/logs/ingestion/<YYYY-MM>/<job_id>.md`
