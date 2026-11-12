import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import MemberPortal from "./MemberPortal";
import "./index.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.hash.startsWith("#/member/") ? <MemberPortal /> : <App />}
  </StrictMode>,
);
