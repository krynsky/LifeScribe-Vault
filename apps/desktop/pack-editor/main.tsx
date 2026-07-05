import React from "react";
import ReactDOM from "react-dom/client";
import { PackEditorApp } from "./PackEditorApp";
import "../src/styles/tokens.css";
import "../src/App.css";
import "./pack-editor.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PackEditorApp />
  </React.StrictMode>,
);
