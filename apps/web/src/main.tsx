import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AccountApp from "./AccountApp";
import "./index.css";
// Account styles follow the legacy dashboard base so both entry points share predictable tokens.
import "./account.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountApp />
  </StrictMode>,
);
