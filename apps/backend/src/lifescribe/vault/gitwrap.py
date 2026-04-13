from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitError(RuntimeError):
    """A git command failed."""


@dataclass(frozen=True)
class GitRepo:
    root: Path

    @classmethod
    def init(cls, root: Path, *, initial_branch: str = "main") -> GitRepo:
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        cls._run(root, ["init", "-b", initial_branch])
        return cls(root=root)

    @classmethod
    def open(cls, root: Path) -> GitRepo:
        root = Path(root)
        if not (root / ".git").exists():
            raise GitError(f"Not a git repository: {root}")
        return cls(root=root)

    def current_branch(self) -> str:
        return self._run(self.root, ["symbolic-ref", "--short", "HEAD"]).strip()

    def add(self, paths: list[str]) -> None:
        if not paths:
            return
        self._run(self.root, ["add", "--", *paths])

    def commit(
        self,
        message: str,
        *,
        author_name: str,
        author_email: str,
    ) -> None:
        env_extra = {
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
        }
        self._run(self.root, ["commit", "-m", message], env_extra=env_extra)

    def is_modified(self, path: str) -> bool:
        """True iff ``path`` is tracked and has uncommitted modifications."""
        out = self._run(self.root, ["status", "--porcelain", "--", path])
        if not out.strip():
            return False
        status = out[:2]
        return "M" in status or ("A" in status and " " in status[1:])

    def log_oneline(self, *, limit: int = 20) -> list[str]:
        out = self._run(self.root, ["log", "--oneline", f"-n{limit}"])
        return [ln for ln in out.splitlines() if ln.strip()]

    @staticmethod
    def _run(
        cwd: Path,
        args: list[str],
        *,
        env_extra: dict[str, str] | None = None,
    ) -> str:
        env = os.environ.copy()
        if env_extra:
            env.update(env_extra)
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
            )
        except FileNotFoundError as e:
            raise GitError("git binary not found on PATH") from e
        except subprocess.CalledProcessError as e:
            raise GitError(f"git {' '.join(args)} failed: {e.stderr.strip()}") from e
        return result.stdout
