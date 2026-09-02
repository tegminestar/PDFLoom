import { ThemeProvider, ToastProvider, TooltipProvider } from "@pdfloom/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { LandingPage } from "./pages/LandingPage";
import "./index.css";

// A tab left open across a deploy still holds the *old* index.html, which
// references JS chunks by their old content hash — hashes that no longer
// exist once the new deploy overwrites dist/assets. The next lazy
// import() (e.g. opening a PDF) then 404s with "Failed to fetch
// dynamically imported module". Vite fires `vite:preloadError` for exactly
// this case; reloading re-fetches the current index.html with the correct
// hashes. The sessionStorage guard stops a reload loop if the failure
// turns out not to be transient (e.g. the asset host is actually down).
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const key = "pdfloom:reloaded-after-preload-error";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  window.location.reload();
});

// Re-arm the guard once the app's been open and healthy for a bit, so a
// *later*, unrelated deploy during the same long-lived tab still gets one
// automatic recovery reload instead of being silently blocked forever by a
// flag left over from an earlier incident.
window.setTimeout(() => sessionStorage.removeItem("pdfloom:reloaded-after-preload-error"), 15_000);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/app" element={<App />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
