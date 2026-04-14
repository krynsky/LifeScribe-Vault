# LLM Providers

LifeScribe Vault talks to Large Language Models through **providers**. Two are
built in: **LM Studio** (runs on your machine) and **GitHub Models** (served
by Microsoft with a GitHub Copilot Pro PAT).

Providers are stored as regular notes in `system/providers/` — you can read
them in Obsidian. Credentials are never written to the vault; they live in the
OS keyring.

## Add LM Studio

1. Install LM Studio and load a model. Open its local server (default
   `http://127.0.0.1:1234`).
2. In LifeScribe Vault, add a provider with:
   - **Display name:** `LM Studio`
   - **Base URL:** `http://127.0.0.1:1234/v1`
   - **Local:** yes
3. No credential needed.

## Add GitHub Models

1. Create a GitHub personal access token with the `models:read` scope. Copy it
   to the clipboard.
2. Add a provider with:
   - **Display name:** `GitHub Models`
   - **Base URL:** `https://models.inference.ai.azure.com`
   - **Local:** no
3. Paste the PAT into the credential field. It's written to the OS keyring,
   never to any file.

## Privacy master-switch

When the privacy switch is on (Settings → Privacy), only providers marked
**local** can be used. Requests to non-local providers are rejected before any
network call happens. The app also verifies at the transport layer that the
provider's URL points at `127.0.0.1`, `::1`, or `localhost` — so a provider
that lies about being local still can't reach the internet.
