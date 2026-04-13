# LifeScribe Vault

A local-first, open-source desktop app that aggregates personal data from local
documents and third-party services into an Obsidian-compatible Markdown vault.
The vault is the human-readable system of record; everything else — indexes,
embeddings, sidecar state — is rebuildable.

## Status

Early design. No code yet. See [`docs/superpowers/specs/`](docs/superpowers/specs/)
for the overview and per-subsystem design documents.

## Planned capabilities

- **Ingest** local documents (PDF, DOCX, XLS/CSV, TXT, MD, HTML, JSON, images, ZIP exports) and write canonical Markdown notes with provenance.
- **Connect** to third-party services via a pluggable connector framework (file, manual-export, API-sync, watch-folder).
- **Chat** with your vault using local (Ollama, LM Studio) or remote (GitHub Models, OpenAI, Anthropic) LLM providers through a unified, OpenAI-compatible interface.
- **Publish** canonical records to external destinations (LifeScribe first; MCP bridge optional) through a pluggable publisher framework.
- **Respect** your data: local-first by default, per-source privacy labels, a "never leave the machine" master switch, and no telemetry.

## License

[MIT](LICENSE)

## Regenerating shared types

After changing backend API routes, run:

- Unix: `bash scripts/gen-types.sh`
- Windows: `powershell -File scripts/gen-types.ps1`
