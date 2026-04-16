"""LifeScribe Vault backend."""

__version__ = "0.1.0"

from pathlib import Path


def connectors_dir() -> Path:
    """Repo-level connectors directory, discoverable at runtime.

    Resolves to <repo_root>/connectors when running from source; in a packaged
    build, the directory is copied next to the executable by the build script.

    Side-effect: ensures the parent dir is on sys.path so that
    `import connectors.<service>.connector` works at runtime.
    """
    import sys

    here = Path(__file__).resolve()
    candidate = here.parents[3] / "connectors"
    if not candidate.exists():
        candidate = Path(sys.executable).parent / "connectors"
    parent = str(candidate.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    return candidate
