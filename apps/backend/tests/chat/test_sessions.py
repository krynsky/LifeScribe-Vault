from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from lifescribe.chat.sessions import SessionStore, auto_title, new_session_id
from lifescribe.vault.schemas import ChatCitation, ChatTurn
from lifescribe.vault.store import VaultStore


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    vault = VaultStore.init(tmp_path, app_version="test")
    return SessionStore(vault=vault)


def test_auto_title_trims_and_strips() -> None:
    assert auto_title("   Hello world   ") == "Hello world"
    long_msg = "A" * 200
    out = auto_title(long_msg)
    assert len(out) <= 60


def test_new_session_id_format() -> None:
    sid = new_session_id("Quarterly Planning!!")
    assert sid.startswith("chat_quarterly_planning_")
    assert len(sid.split("_")[-1]) == 6


def test_create_session_persists_first_turn(store: SessionStore) -> None:
    turn = ChatTurn(role="user", content="hi", created_at=datetime.now(tz=UTC))
    session = store.create(
        title="greeting",
        provider_id="llm_a",
        model="m",
        first_turn=turn,
    )
    assert session.id.startswith("chat_greeting_")
    reloaded = store.read(session.id)
    assert len(reloaded.turns) == 1
    assert reloaded.turns[0].content == "hi"


def test_append_turn_pair(store: SessionStore) -> None:
    now = datetime.now(tz=UTC)
    session = store.create(
        title="t",
        provider_id="p",
        model="m",
        first_turn=ChatTurn(role="user", content="q1", created_at=now),
    )
    store.append_turn_pair(
        session_id=session.id,
        assistant=ChatTurn(
            role="assistant",
            content="a1 [1]",
            created_at=now,
            citations=[
                ChatCitation(
                    marker=1, note_id="doc_a", chunk_id="cc", score=-8.0, resolved=True
                )
            ],
        ),
    )
    reloaded = store.read(session.id)
    assert len(reloaded.turns) == 2
    assert reloaded.turns[1].citations[0].resolved

    store.append_turn_pair(
        session_id=session.id,
        user=ChatTurn(role="user", content="q2", created_at=now),
        assistant=ChatTurn(role="assistant", content="a2", created_at=now),
    )
    reloaded = store.read(session.id)
    assert [t.content for t in reloaded.turns] == ["q1", "a1 [1]", "q2", "a2"]


def test_list_sessions_newest_first(store: SessionStore) -> None:
    now = datetime.now(tz=UTC)
    a = store.create(
        title="a", provider_id="p", model="m",
        first_turn=ChatTurn(role="user", content="a", created_at=now),
    )
    b = store.create(
        title="b", provider_id="p", model="m",
        first_turn=ChatTurn(role="user", content="b", created_at=now),
    )
    ids = [s.id for s in store.list()]
    # newest first — b was created second
    assert ids.index(b.id) < ids.index(a.id)


def test_delete_removes_file(store: SessionStore, tmp_path: Path) -> None:
    now = datetime.now(tz=UTC)
    s = store.create(
        title="t", provider_id="p", model="m",
        first_turn=ChatTurn(role="user", content="x", created_at=now),
    )
    assert (tmp_path / "70_chats" / f"{s.id}.md").exists()
    store.delete(s.id)
    assert not (tmp_path / "70_chats" / f"{s.id}.md").exists()
