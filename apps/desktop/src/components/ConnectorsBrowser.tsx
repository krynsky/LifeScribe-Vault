import { useState } from "react";
import ReactMarkdown from "react-markdown";

import type { ConnectorCatalogEntry } from "../api/client";
import { useConnectors } from "../api/queries";

function EntryCard({ entry }: { entry: ConnectorCatalogEntry }) {
  const [open, setOpen] = useState(false);
  const panelId = `connector-panel-${entry.service}`;
  return (
    <li
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 12,
        marginBottom: 8,
        opacity: entry.blocked ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontWeight: 600,
          cursor: "pointer",
          fontSize: "1em",
        }}
      >
        {entry.display_name}
      </button>{" "}
      <span style={{ color: "#666", fontSize: "0.9em" }}>
        ({entry.category} · {entry.auth_mode} · {entry.tier})
      </span>{" "}
      {entry.blocked && (
        <span
          title="This connector requires network access; Privacy Mode is on."
          style={{
            marginLeft: 8,
            padding: "2px 6px",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: 4,
            fontSize: "0.8em",
          }}
        >
          blocked by privacy mode
        </span>
      )}
      <div style={{ color: "#555", marginTop: 4 }}>{entry.description}</div>
      {open && (
        <div id={panelId} style={{ marginTop: 12 }}>
          {entry.export_instructions && (
            <div style={{ marginBottom: 12 }}>
              <ReactMarkdown>{entry.export_instructions}</ReactMarkdown>
            </div>
          )}
          {entry.sample_file_urls.length > 0 && (
            <div>
              <strong>Sample files:</strong>
              <ul>
                {entry.sample_file_urls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url.split("/").pop()}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ConnectorsBrowser() {
  const { data, isLoading, error } = useConnectors();
  if (error)
    return (
      <div role="alert" style={{ color: "#b00" }}>
        Failed to load connectors: {(error as Error).message}
      </div>
    );
  if (isLoading || !data) return <div>Loading connectors…</div>;

  return (
    <fieldset>
      <legend>Available connectors</legend>
      {data.warnings.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#fff3cd",
            border: "1px solid #ffc107",
            padding: 8,
            borderRadius: 4,
            marginBottom: 8,
          }}
        >
          {data.warnings.length} connector{data.warnings.length === 1 ? "" : "s"} failed to load.
          <details style={{ marginTop: 4 }}>
            <summary>details</summary>
            <ul>
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.entries.map((e) => (
          <EntryCard key={e.service} entry={e} />
        ))}
      </ul>
    </fieldset>
  );
}
