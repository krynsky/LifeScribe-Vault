from __future__ import annotations

from lifescribe.retrieval.chunker import Chunk, chunk_text

TARGET = 500  # approx tokens
SHORT = "one paragraph here.\n\nanother paragraph."


def test_short_text_yields_single_chunk() -> None:
    chunks = chunk_text(SHORT, note_id="doc_a")
    assert len(chunks) == 1
    assert chunks[0].note_id == "doc_a"
    assert chunks[0].start_offset == 0
    assert chunks[0].end_offset == len(SHORT)
    assert chunks[0].content == SHORT


def test_chunk_id_is_stable_and_short() -> None:
    a = chunk_text(SHORT, note_id="doc_a")[0].chunk_id
    b = chunk_text(SHORT, note_id="doc_a")[0].chunk_id
    assert a == b
    assert len(a) == 12


def test_different_notes_yield_different_chunk_ids() -> None:
    a = chunk_text(SHORT, note_id="doc_a")[0].chunk_id
    b = chunk_text(SHORT, note_id="doc_b")[0].chunk_id
    assert a != b


def test_long_text_splits_on_paragraph_boundaries() -> None:
    paragraphs = [("word " * 250).strip() for _ in range(4)]  # ~1000 chars each
    text = "\n\n".join(paragraphs)
    chunks = chunk_text(text, note_id="doc_a")
    assert len(chunks) >= 2
    for c in chunks:
        assert c.content.strip(), "chunks must have content"
        # paragraph boundaries preserved where possible
        assert "\n\n" not in c.content.strip("\n")


def test_oversized_paragraph_falls_back_to_sentence_split() -> None:
    # one giant paragraph, no blank lines
    giant = ". ".join(["word " * 40 for _ in range(30)])
    chunks = chunk_text(giant, note_id="doc_a")
    assert len(chunks) >= 2


def test_chunks_cover_full_text_contiguously() -> None:
    text = "\n\n".join(["para " * 100 for _ in range(5)])
    chunks = chunk_text(text, note_id="doc_a")
    # start_offset of first is 0; end of last is len(text); chunks don't overlap
    assert chunks[0].start_offset == 0
    assert chunks[-1].end_offset == len(text)
    for a, b in zip(chunks, chunks[1:]):
        assert a.end_offset <= b.start_offset
