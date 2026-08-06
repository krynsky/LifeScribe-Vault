import ReactMarkdown from "react-markdown";
import guideMarkdown from "../../../../docs/user-guide.md?raw";

/**
 * Renders docs/user-guide.md directly — the file is the single source of
 * truth for this content, imported as raw text at build time. No fetch, no
 * vaultApi, no Tauri IPC: this page is fully static and behaves the same
 * regardless of what's in the vault.
 */
export function HelpPage() {
  return (
    <div className="help-page">
      <ReactMarkdown>{guideMarkdown}</ReactMarkdown>
    </div>
  );
}
