// Vite-specific `?url` import resolves to the built worker asset's final URL,
// both in dev (served from node_modules) and in the production bundle. This
// only touches the Vite build convention, which every shell in this monorepo
// (apps/web today, a future Tauri desktop shell) uses, so it stays valid
// across shells despite living in the "framework-agnostic" core package.
// It's a URL string, not the worker's code, so it's cheap regardless.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * pdf.js's main bundle is large (~800KB) and only needed once a user
 * actually opens a document — a dynamic import keeps it out of the initial
 * page load (welcome screen, empty state) and fetches it on first use,
 * caching the result for every subsequent call.
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist").then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return mod;
  });
  return pdfjsPromise;
}
