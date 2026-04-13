import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import type { VaultStatusDTO } from "./api/client";
import { api } from "./api/client";
import FirstRunWizard from "./views/FirstRunWizard";
import { router } from "./router";

export default function App() {
  const [status, setStatus] = useState<VaultStatusDTO | null>(null);

  async function refresh() {
    try {
      const s = await api.status();
      setStatus(s);
    } catch (e) {
      console.error(e);
      setStatus({ open: false, manifest: null });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (status === null) return <div style={{ padding: 24 }}>Starting backend…</div>;
  if (!status.open || !status.manifest) return <FirstRunWizard onOpened={refresh} />;
  return <RouterProvider router={router} />;
}
