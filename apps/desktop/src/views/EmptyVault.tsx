import type { VaultManifestDTO } from "../api/client";

interface Props {
  manifest: VaultManifestDTO;
}

export default function EmptyVault({ manifest }: Props) {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Your vault is empty.</h1>
      <p>Ingestion lands in sub-project 3.2. For now, the vault is ready and tracked in git.</p>
      <dl>
        <dt>Vault ID</dt>
        <dd>
          <code>{manifest.id}</code>
        </dd>
        <dt>Schema version</dt>
        <dd>{manifest.schema_version}</dd>
        <dt>Created</dt>
        <dd>{new Date(manifest.created_at).toLocaleString()}</dd>
      </dl>
    </div>
  );
}
