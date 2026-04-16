# LifeScribe Connectors

Each subdirectory is a self-contained connector. The backend scans this folder at startup and discovers available connectors via `manifest.toml`.

## Adding a connector

1. Create `connectors/<service>/manifest.toml` — metadata + runtime contract.
2. Create `connectors/<service>/connector.py` — subclass of `lifescribe.connectors.Connector`.
3. Add `connectors/<service>/samples/` with 1–2 representative files.
4. Add `connectors/<service>/README.md` describing the service and export process.
5. Run the contract test: `cd apps/backend && uv run pytest tests/integration/test_connector_contract.py -q`.

## Manifest schema (v1)

| field | required | notes |
|---|---|---|
| `manifest_schema_version` | yes | currently `1` |
| `service` | yes | unique slug; `[a-z0-9_]+` |
| `display_name` | yes | human-readable |
| `description` | no | 1–2 sentence summary |
| `category` | yes | free-form; UI groups by this |
| `auth_mode` | yes | `none` \| `manual_export` \| `oauth` \| `api_key` |
| `tier` | yes | `free` \| `freemium` \| `paid` |
| `connector_type` | yes | `file` \| `manual_export` \| `api_sync` \| `watch_folder` \| `bridge` |
| `entry_point` | yes | `module:Class` resolvable by `importlib.import_module` |
| `supported_formats` | no | list of file extensions without dot |
| `privacy_posture` | yes | `local_only` \| `requires_network` |
| `export_instructions` | no | markdown |
| `sample_files` | no | paths relative to manifest dir |

`privacy_posture = "requires_network"` connectors are blocked when Privacy Mode is on. The framework enforces this at the orchestration boundary.
