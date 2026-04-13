from __future__ import annotations

from lifescribe.vault.schemas import IngestJobLog
from lifescribe.vault.serialization import dump_note


def _body(log: IngestJobLog) -> str:
    lines = [
        f"# Ingestion job `{log.id}`",
        "",
        "| # | File | Status | Source | Extractor | Error |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for f in log.files:
        lines.append(
            f"| {f.index} | {f.path} | {f.status.value} | "
            f"{f.source_id or ''} | {f.extractor or ''} | {f.error or ''} |"
        )
    return "\n".join(lines) + "\n"


def render_log(log: IngestJobLog, *, include_frontmatter: bool = True) -> str:
    body = _body(log)
    if not include_frontmatter:
        return body
    return dump_note(log, body=body)
