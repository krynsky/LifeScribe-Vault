export interface Section {
  path: string;
  label: string;
  icon: string;
}

export const SECTIONS: readonly Section[] = [
  { path: "/browse", label: "Browse", icon: "📄" },
  { path: "/import", label: "Import", icon: "⬇" },
  { path: "/chat", label: "Chat", icon: "💬" },
  { path: "/logs", label: "Logs", icon: "📜" },
  { path: "/settings", label: "Settings", icon: "⚙" },
] as const;
