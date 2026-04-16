import { Navigate, createBrowserRouter } from "react-router-dom";

import AppShell from "./shell/AppShell";
import BrowseRoute from "./routes/BrowseRoute";
import ImportRoute from "./routes/ImportRoute";
import LogsRoute from "./routes/LogsRoute";
import NoteViewerRoute from "./routes/NoteViewerRoute";
import SettingsRoute from "./routes/SettingsRoute";
import { ChatRoute } from "./routes/ChatRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/browse" replace /> },
      { path: "browse", element: <BrowseRoute /> },
      { path: "browse/:id", element: <NoteViewerRoute /> },
      { path: "import", element: <ImportRoute /> },
      { path: "chat", element: <ChatRoute /> },
      { path: "chat/:sessionId", element: <ChatRoute /> },
      { path: "logs", element: <LogsRoute /> },
      { path: "logs/:id", element: <NoteViewerRoute /> },
      { path: "settings", element: <SettingsRoute /> },
    ],
  },
]);
