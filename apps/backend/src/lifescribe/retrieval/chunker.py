from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

# approximate tokens by characters
_TARGET_TOKENS = 500
_CHARS_PER_TOKEN = 4
_TARGET_CHARS = _TARGET_TOKENS * _CHARS_PER_TOKEN
_MAX_CHARS = int(_TARGET_CHARS * 1.2)


@dataclass(frozen=True)
class Chunk:
    note_id: str
    chunk_id: str
    content: str
    start_offset: int
    end_offset: int


def _chunk_id_for(note_id: str, start: int, end: int) -> str:
    raw = f"{note_id}:{start}:{end}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:12]


def _split_paragraphs(text: str) -> list[tuple[int, int]]:
    # returns (start, end) offsets of paragraph blocks (text[s:e])
    spans: list[tuple[int, int]] = []
    i = 0
    for match in re.finditer(r"\n{2,}", text):
        spans.append((i, match.start()))
        i = match.end()
    spans.append((i, len(text)))
    return [s for s in spans if s[1] > s[0]]


def _split_sentences(text: str, base_offset: int) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    i = 0
    for match in re.finditer(r"(?<=[.!?])\s+", text):
        spans.append((base_offset + i, base_offset + match.start()))
        i = match.end()
    if i < len(text):
        spans.append((base_offset + i, base_offset + len(text)))
    return [s for s in spans if s[1] > s[0]]


def _hard_wrap(text: str, base_offset: int, max_chars: int) -> list[tuple[int, int]]:
    spans = []
    i = 0
    while i < len(text):
        j = min(i + max_chars, len(text))
        spans.append((base_offset + i, base_offset + j))
        i = j
    return spans


def chunk_text(text: str, *, note_id: str) -> list[Chunk]:
    if not text.strip():
        return []
    spans = _split_paragraphs(text)

    # expand oversized paragraphs into sentences, then hard-wrap if still too big
    expanded: list[tuple[int, int]] = []
    for s, e in spans:
        if e - s <= _MAX_CHARS:
            expanded.append((s, e))
            continue
        sub = _split_sentences(text[s:e], base_offset=s)
        for ss, se in sub:
            if se - ss <= _MAX_CHARS:
                expanded.append((ss, se))
            else:
                expanded.extend(_hard_wrap(text[ss:se], ss, _MAX_CHARS))

    # pack consecutive spans up to target size
    chunks: list[Chunk] = []
    buf_start: int | None = None
    buf_end: int | None = None
    for s, e in expanded:
        if buf_start is None:
            buf_start, buf_end = s, e
            continue
        assert buf_end is not None
        if e - buf_start <= _TARGET_CHARS:
            buf_end = e
        else:
            chunks.append(
                Chunk(
                    note_id=note_id,
                    chunk_id=_chunk_id_for(note_id, buf_start, buf_end),
                    content=text[buf_start:buf_end],
                    start_offset=buf_start,
                    end_offset=buf_end,
                )
            )
            buf_start, buf_end = s, e
    if buf_start is not None and buf_end is not None:
        chunks.append(
            Chunk(
                note_id=note_id,
                chunk_id=_chunk_id_for(note_id, buf_start, buf_end),
                content=text[buf_start:buf_end],
                start_offset=buf_start,
                end_offset=buf_end,
            )
        )
    return chunks
