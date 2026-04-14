from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from lifescribe.vault.schemas import SourceRecord
from lifescribe.vault.store import VaultStore


def _ts() -> datetime:
    return datetime(2026, 4, 12, 14, 8, 3, tzinfo=UTC)


def _src(hash_suffix: str = "abcd") -> SourceRecord:
    return SourceRecord(
        id=f"src_hello_{hash_suffix}",
        type="SourceRecord",
        schema_version=1,
        source_path="/tmp/hello.txt",
        source_hash=f"sha256:{hash_suffix}",
        source_mtime=_ts(),
        imported_at=_ts(),
        imported_by_job="job_2026-04-12_001",
        extractor="test@0.0.1",
        extractor_confidence=1.0,
        privacy="private",
        links={"parent_source": None, "derived_from": []},
        tags=[],
        mime_type="text/plain",
        original_filename="hello.txt",
        size_bytes=5,
    )


def test_write_and_read(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src()
    result = store.write_note(rec, body="hi", commit_message="ingest: test")
    assert result.conflict is False
    assert result.path == tmp_vault / "10_sources" / "src_hello_abcd.md"
    loaded_note, body = store.read_note(rec.id)
    assert loaded_note == rec
    assert body == "hi"


def test_write_commits(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    store.write_note(_src(), body="hi", commit_message="ingest: test")
    log = store._repo.log_oneline()
    assert log[0].endswith("ingest: test") or "ingest: test" in log[0]


def test_hand_edit_routes_to_conflict_file(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    rec = _src()
    first = store.write_note(rec, body="v1", commit_message="ingest: v1")
    first.path.write_text(first.path.read_text(encoding="utf-8") + "\nhand\n", encoding="utf-8")
    second = store.write_note(rec, body="v2", commit_message="ingest: v2")
    assert second.conflict is True
    assert ".conflict-" in second.path.name
    assert second.path.parent == tmp_vault / "10_sources"


def test_exists(tmp_vault: Path) -> None:
    store = VaultStore.init(tmp_vault, app_version="0.1.0")
    assert store.exists("src_nope_abcd") is False
    rec = _src()
    store.write_note(rec, body="", commit_message="ingest: x")
    assert store.exists(rec.id) is True


def test_write_llm_provider_goes_to_system_providers(tmp_path) -> None:
    from lifescribe.vault.schemas import LLMProvider
    from lifescribe.vault.store import VaultStore

    store = VaultStore.init(tmp_path / "v", app_version="test")
    note = LLMProvider(
        id="llm_lmstudio_default",
        type="LLMProvider",
        display_name="LM Studio",
        base_url="http://127.0.0.1:1234/v1",
        local=True,
    )
    result = store.write_note(note, body="", commit_message="llm: add lmstudio")
    assert result.path == tmp_path / "v" / "system" / "providers" / "llm_lmstudio_default.md"
    assert result.path.exists()

    loaded, _body = store.read_note("llm_lmstudio_default")
    assert isinstance(loaded, LLMProvider)
    assert loaded.display_name == "LM Studio"


def test_chat_session_routes_to_70_chats(tmp_path):
    from datetime import UTC, datetime
    from lifescribe.vault.schemas import ChatSession, ChatTurn
    from lifescribe.vault.store import VaultStore

    store = VaultStore.init(tmp_path, app_version="test")
    session = ChatSession(
        id="chat_greeting_ab12cd",
        type="ChatSession",
        title="greeting",
        provider_id="llm_lm_studio_abc",
        model="qwen3-14b",
        turns=[ChatTurn(role="user", content="hi", created_at=datetime.now(tz=UTC))],
    )
    store.write_note(session, body="", commit_message="chat: add session")
    assert (tmp_path / "70_chats" / "chat_greeting_ab12cd.md").exists()
