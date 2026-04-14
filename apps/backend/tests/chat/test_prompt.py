from lifescribe.chat.prompt import build_system_prompt
from lifescribe.retrieval.index import SearchResult


def _sr(note_id: str, note_type: str, content: str, score: float) -> SearchResult:
    return SearchResult(
        note_id=note_id,
        chunk_id="c1",
        note_type=note_type,
        tags=[],
        imported_at="",
        content=content,
        score=score,
        snippet=content[:40],
    )


def test_prompt_has_preamble_and_numbered_sources() -> None:
    chunks = [
        _sr("doc_a", "DocumentRecord", "quarterly planning notes", -8.0),
        _sr("doc_b", "DocumentRecord", "ops retrospective", -7.5),
    ]
    out = build_system_prompt(chunks)
    assert "cite every factual claim" in out.lower()
    assert "Sources:" in out
    assert "[1] (DocumentRecord doc_a" in out
    assert "[2] (DocumentRecord doc_b" in out
    assert "quarterly planning notes" in out
    assert "ops retrospective" in out


def test_empty_chunks_still_produces_preamble() -> None:
    out = build_system_prompt([])
    assert "Sources:" in out


def test_chunk_order_is_preserved() -> None:
    chunks = [
        _sr("doc_first", "DocumentRecord", "first", -9.0),
        _sr("doc_second", "DocumentRecord", "second", -5.0),
    ]
    out = build_system_prompt(chunks)
    assert out.index("[1] (DocumentRecord doc_first") < out.index(
        "[2] (DocumentRecord doc_second"
    )
