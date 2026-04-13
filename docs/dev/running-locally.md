# Running locally

## Prerequisites
- Git
- Python 3.12 and [uv](https://github.com/astral-sh/uv)
- Node.js 20+
- Rust stable toolchain (via rustup)
- Platform-specific Tauri dependencies:
  - **Linux:** `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`
  - **macOS:** Xcode command line tools
  - **Windows:** WebView2 Runtime (pre-installed on Win 11)

## First-time setup

```bash
# Backend
cd apps/backend
uv sync --extra dev

# Frontend
cd ../..
npm install
```

## Build the backend binary (required for Tauri sidecar)

```bash
bash scripts/build-backend.sh           # Unix
# or
powershell -File scripts/build-backend.ps1   # Windows
```

Then copy the output into Tauri's sidecar directory:

```bash
mkdir -p apps/desktop/src-tauri/binaries
cp apps/backend/dist/lifescribe-backend apps/desktop/src-tauri/binaries/lifescribe-backend-$(rustc -vV | awk '/host/{print $2}')
```

On Windows, append `.exe` to the copy target.

## Run

```bash
bash scripts/dev.sh            # full desktop app
bash scripts/dev.sh backend-only
bash scripts/dev.sh frontend-only
```

## Tests

```bash
cd apps/backend && uv run pytest
cd apps/desktop && npm test
```
