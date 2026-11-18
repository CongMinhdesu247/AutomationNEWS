import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AccountApp from "./AccountApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lazyWithRetry } from "./lib/format";
import "./index.css";
// Account styles follow the legacy dashboard base so both entry points share predictable tokens.
import "./account.css";

const MemberPortal = lazyWithRetry(() => import("./MemberPortal"));

function isMemberPortalHash(hash: string): boolean {
  return hash === "#/member" || hash.startsWith("#/member/");
}

function RootRouter() {
  const [memberMode, setMemberMode] = useState(() =>
    isMemberPortalHash(window.location.hash),
  );

  useEffect(() => {
    const onHash = () => setMemberMode(isMemberPortalHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (memberMode) {
    return (
      <Suspense
        fallback={
          <main className="account-shell">
            <p role="status">Đang mở hồ sơ thành viên…</p>
          </main>
        }
      >
        <MemberPortal />
      </Suspense>
    );
  }

  return <AccountApp />;
}

if (
  "serviceWorker" in navigator &&
  (import.meta.env.PROD ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootRouter />
    </ErrorBoundary>
  </StrictMode>,
);
