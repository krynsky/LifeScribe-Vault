"""LifeScribe Vault backend."""

import sys
from pathlib import Path
from typing import cast

__version__ = "0.1.0"


def connectors_dir() -> Path:
    """Repo-level connectors directory, discoverable at runtime.

    Resolves to <repo_root>/connectors when running from source; in a packaged
    build, the directory is copied next to the executable by the build script.

    Side-effect: if the resolved directory exists, ensures its parent is on
    sys.path so that `import connectors.<service>.connector` works at runtime.
    """
    here = Path(__file__).resolve()
    candidates: list[Path] = []
    pyinstaller_root = cast(str | None, getattr(sys, "_MEIPASS", None))
    if pyinstaller_root:
        candidates.append(Path(pyinstaller_root) / "connectors")
    candidates.append(here.parents[4] / "connectors")
    candidates.append(Path(sys.executable).parent / "connectors")

    candidate = next((path for path in candidates if path.exists()), candidates[-1])
    if candidate.exists():
        parent = str(candidate.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
    return candidate
