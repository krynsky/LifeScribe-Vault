from __future__ import annotations

from typing import cast

import frontmatter
import yaml

from lifescribe.vault.schemas import Note, parse_note


def dump_note(note: Note, body: str) -> str:
    """Serialize a Note and body to a Markdown file string with YAML frontmatter."""
    data = note.model_dump(mode="json", exclude_none=False)
    yaml_text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True).rstrip("\n")
    return f"---\n{yaml_text}\n---\n{body}"


def load_note(text: str) -> tuple[Note, str]:
    """Parse a Markdown file string into (Note, body). Raises if frontmatter invalid."""
    post = frontmatter.loads(text)
    note = parse_note(cast(dict[str, object], post.metadata))
    return note, post.content
