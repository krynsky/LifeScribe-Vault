import type { ReactNode } from "react";

export interface AppShellProps {
  /** Left sidebar: guided checklist + utility navigation. */
  sidebar: ReactNode;
  /** Main pane content. */
  children: ReactNode;
}

/** Two-pane dashboard shell: fixed sidebar, scrollable main pane. */
export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="app-frame">
      <aside className="app-frame__sidebar">{sidebar}</aside>
      <main className="app-frame__main">{children}</main>
    </div>
  );
}
