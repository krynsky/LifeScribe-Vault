from __future__ import annotations

from pathlib import Path

import pytest

from lifescribe.vault.gitwrap import GitError, GitRepo


def test_init_creates_dot_git(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    assert (tmp_vault / ".git").is_dir()
    assert repo.current_branch() == "main"


def test_commit_produces_log_entry(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    (tmp_vault / "a.md").write_text("hello\n", encoding="utf-8")
    repo.add(["a.md"])
    repo.commit("chore: add a", author_name="Tester", author_email="t@example.com")
    log = repo.log_oneline(limit=10)
    assert len(log) == 1
    assert "chore: add a" in log[0]


def test_is_modified_detects_unstaged_edit(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    (tmp_vault / "a.md").write_text("v1\n", encoding="utf-8")
    repo.add(["a.md"])
    repo.commit("chore: v1", author_name="T", author_email="t@t.t")
    assert repo.is_modified("a.md") is False
    (tmp_vault / "a.md").write_text("v2\n", encoding="utf-8")
    assert repo.is_modified("a.md") is True


def test_is_modified_false_for_untracked_path(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    assert repo.is_modified("does-not-exist.md") is False


def test_commit_errors_when_nothing_staged(tmp_vault: Path) -> None:
    repo = GitRepo.init(tmp_vault, initial_branch="main")
    with pytest.raises(GitError):
        repo.commit("chore: empty", author_name="T", author_email="t@t.t")
