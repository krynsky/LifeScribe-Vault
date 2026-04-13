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

## Supported formats (v1)

TXT, MD, JSON, CSV, HTML, PDF, DOCX, XLSX, and images (PNG/JPG/GIF/WebP/BMP/TIFF).
Images are stored as assets with EXIF metadata; their body is empty
until OCR arrives in a later release.

## Re-importing the same file

Re-importing a file with identical bytes and the same filename is a
no-op for the affected note (idempotency). The ingestion log still
records the attempt under `skipped_identical`.

## Where things land

- Note: `10_sources/<source_id>.md`
- Original bytes: `assets/<first-2-hex>/<sha256>/<original-filename>`
- Job log: `system/logs/ingestion/<YYYY-MM>/<job_id>.md`
