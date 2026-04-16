# Connectors

LifeScribe imports data through **connectors** — small adapters that know how to read a specific kind of source (files, exports, APIs). v1 ships with one: **File Drop**.

## Browsing the catalog

Settings → Connectors lists every connector the app knows about, with:

- a short description
- supported file formats (when applicable)
- export instructions (expand the card)
- sample files you can download to see what the connector accepts

Entries that require network access are greyed out when Privacy Mode is on. The backend will also refuse an import from any such connector while Privacy Mode is active.

## File Drop

File Drop accepts PDFs, plain text, markdown, and common image formats. To use it:

- drag a file into the app window, or
- use the **Import → File** button on the Dashboard

Duplicate imports (same content hash) are detected automatically and skipped.

## Adding a new connector

LifeScribe's connector framework is the primary open-source contribution surface. To add support for a new service, create a new directory under `connectors/<service>/` with a `manifest.toml` and a `connector.py` subclassing `lifescribe.connectors.Connector`. See [connectors/README.md](../../connectors/README.md) for the full manifest schema.
