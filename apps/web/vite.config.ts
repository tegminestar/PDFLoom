import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "PDFLoom",
        short_name: "PDFLoom",
        description: "A premium, AI-native PDF editor. 100% local — your files never leave your device.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f1115",
        theme_color: "#0f1115",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App-shell assets only. AI model weights (later milestones) are
        // cached separately via the Cache API by the AI engine itself, not
        // precached here — they're 10s-100s of MB and fetched on demand.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "fonts" },
          },
        ],
      },
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // Workspace packages are consumed as raw TS source (see their
    // package.json `main`), not pre-built — exclude them from esbuild's dep
    // pre-bundling so edits inside packages/* are picked up without a stale
    // cache, and let Vite transform them like any other first-party source.
    exclude: ["@pdfloom/core", "@pdfloom/ui"],
  },
  worker: {
    format: "es",
  },
  // Cross-origin isolation (COOP+COEP) is what unlocks SharedArrayBuffer,
  // which onnxruntime-web's WASM backend needs to run multi-threaded —
  // without it, every AI feature runs single-threaded no matter how many
  // cores the user's machine has. Measured directly: summarizing a
  // realistic 500-page document took ~21 minutes on this single-threaded
  // path. Set here (not just in staticwebapp.config.json) so `pnpm dev`
  // reproduces the same isolation the deployed site has — this can only be
  // verified by actually running the app under it, not by inspection, so
  // local dev needs to match production exactly.
  server: {
    // Explicit IPv4 loopback, not the bare default ("localhost") — that
    // resolves to whatever this machine's Node/OS happens to prefer at
    // that moment, which was observed to vary run-to-run between IPv4
    // (127.0.0.1) and IPv6-only (::1). Playwright's own baseURL
    // (playwright.config.ts) is "http://localhost:5173", so any time the
    // two disagreed on which stack "localhost" meant, page.goto hung until
    // its own timeout — this is the likely real cause behind at least some
    // of the "cold start" e2e flakiness chased down elsewhere this session,
    // not a property of Vite startup cost itself.
    host: "127.0.0.1",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    host: "127.0.0.1",
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
