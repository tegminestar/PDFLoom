# apps/web

The PDFLoom web app — the marketing landing page (`/`) and the full editor
(`/app`), both in this one Vite/React project. See the [root README](../../README.md)
for the whole monorepo and [PRD.md](../../PRD.md) for product requirements.

## What's here

```
src/pages/LandingPage.tsx     Marketing page at "/"
src/App.tsx                   The editor shell at "/app" — rail, toolbar,
                               panels, command palette, all mode routing
src/app/store.ts               Single Zustand store — all editor state
src/features/                  One folder per tool: viewer, organize, edit,
                                convert, forms, sign, protect, annotate, ai,
                                quick-create, compare, account, collab
                                (Live Review), analytics (owner dashboard),
                                feedback
```

Every feature folder under `src/features/` follows the same shape: a
Toolbar component for that mode, an Overlay component that renders on top
of the page canvas when relevant, and a Dialog component for anything
that isn't a full mode switch. `PageCanvas.tsx` (in `features/viewer/`) is
the one place all of those overlays actually mount.

## Local development

```
pnpm install          # from the repo root — this is a workspace, not standalone
pnpm --filter @pdfloom/web dev
```

Copy `.env.example` to `.env.local` and fill in real values if you need the
account/billing UI to work — core PDF editing works with none of them set.

## Testing

```
node_modules/.bin/tsc -b --noEmit                                       # typecheck (tsc -b, project references)
node_modules/.bin/playwright test --reporter=list --grep-invert "real local AI model"   # full e2e suite
```

The `--grep-invert` exclusion skips the one test that needs a real local AI
model + WebGPU — everything else runs in plain headless Chromium. E2E specs
live in `e2e/`, one file per feature area, using real generated PDF
fixtures (`e2e/fixtures/`) rather than mocks.

## Building

`pnpm --filter @pdfloom/web build` runs `tsc -b && vite build`, output to
`dist/`. This is what `deploy-web.yml` (repo root `.github/workflows/`) and
`apps/desktop`'s Tauri build both actually ship.
