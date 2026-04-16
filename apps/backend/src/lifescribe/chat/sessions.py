from __future__ import annotations

import re
import secrets as _secrets

from lifescribe.vault.schemas import ChatSession, ChatTurn
from lifescribe.vault.store import VaultStore


def auto_title(message: str) -> str:
    text = message.strip()
    return text[:60]


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s or "chat"


def new_session_id(title: str) -> str:
    return f"chat_{_slug(title)}_{_secrets.token_hex(3)}"


def _render_body(turns: list[ChatTurn]) -> str:
    parts = []
    for turn in turns:
        header = "### You" if turn.role == "user" else "### Assistant"
        parts.append(f"{header}\n\n{turn.content}\n")
    return "\n".join(parts)


class SessionStore:
    def __init__(self, *, vault: VaultStore) -> None:
        self._vault = vault

    def create(
        self,
        *,
        title: str,
        provider_id: str,
        model: str,
        first_turn: ChatTurn,
    ) -> ChatSession:
        clean_title = auto_title(title)
        session = ChatSession(
            id=new_session_id(clean_title),
            type="ChatSession",
            title=clean_title,
            provider_id=provider_id,
            model=model,
            turns=[first_turn],
        )
        self._vault.write_note(
            session,
            body=_render_body(session.turns),
            commit_message=f"chat: create session {session.id}",
        )
        return session

    def read(self, session_id: str) -> ChatSession:
        note, _ = self._vault.read_note(session_id)
        if not isinstance(note, ChatSession):
            raise KeyError(session_id)
        return note

    def append_turn_pair(
        self,
        *,
        session_id: str,
        user: ChatTurn | None = None,
        assistant: ChatTurn,
    ) -> ChatSession:
        session = self.read(session_id)
        if user is not None:
            session.turns.append(user)
        session.turns.append(assistant)
        self._vault.write_note(
            session,
            body=_render_body(session.turns),
            commit_message=f"chat: session {session.id} turn {len(session.turns)}",
        )
        return session

    def list(self) -> list[ChatSession]:
        sessions = [
            n for n in self._vault.list_notes(type_="ChatSession") if isinstance(n, ChatSession)
        ]
        # Sort by file mtime (newest first) so that sessions created later appear first.
        # This is reliable even when multiple sessions share the same turn timestamp.

        def _mtime(s: ChatSession) -> float:
            path = self._vault.path_for(s.id)
            if path and path.exists():
                return path.stat().st_mtime
            return 0.0

        sessions.sort(key=_mtime, reverse=True)
        return sessions

    def patch_first_turn(self, session_id: str, turn: ChatTurn) -> ChatSession:
        session = self.read(session_id)
        session.turns[0] = turn
        self._vault.write_note(
            session,
            body=_render_body(session.turns),
            commit_message=f"chat: session {session_id} patch first turn",
        )
        return session

    def delete(self, session_id: str) -> None:
        self._vault.delete_note(
            session_id,
            commit_message=f"chat: delete session {session_id}",
        )
