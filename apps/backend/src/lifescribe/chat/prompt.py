from __future__ import annotations

from lifescribe.retrieval.index import SearchResult

_PREAMBLE = (
    "You are LifeScribe Vault's research assistant. Answer the user's "
    "question using ONLY the numbered sources below. Cite every factual "
    "claim inline as [N] where N matches a source number. If the sources "
    "do not contain the answer, say so — do not draw on outside knowledge.\n\n"
    "Sources:\n"
)


def build_system_prompt(chunks: list[SearchResult]) -> str:
    parts = [_PREAMBLE]
    for i, chunk in enumerate(chunks, start=1):
        parts.append(f"[{i}] ({chunk.note_type} {chunk.note_id})\n{chunk.content}\n\n")
    return "".join(parts).rstrip() + "\n"
