# PDFLoom

*Weave every page.*

A premium, AI-native PDF editor. Every PDF and AI operation runs 100%
client-side (WASM/WebGPU) — no server ever touches your files, no account,
no API key. See [PRD.md](PRD.md) for the full product requirements and the
engineering standards this repo is held to.

**Live**
- Web app: https://pdfloom.app (custom domain via Cloudflare DNS; the Azure-assigned `https://happy-smoke-002c10c1e.3.azurestaticapps.net` also still works)
- Desktop downloads (Windows/macOS/Linux): `https://pdfloomdownloads.blob.core.windows.net/downloads/PDFLoom-latest-*`
- Billing API health check: https://pdfloom-api-tegminestar.azurewebsites.net/api/health

## Repo layout

Pnpm workspace monorepo — one engine, multiple shells:

```
packages/core     Framework-agnostic PDF/AI/storage engine (no React, no DOM assumptions)
packages/ui       "Loom UI" design system (Radix + Tailwind), shared by every shell
apps/web          The Vite/React app — editor + marketing landing page
apps/desktop      Tauri wrapper around apps/web's own build output (same code, packaged native)
apps/api          Minimal Express server — Stripe + Supabase only, for Pro-tier billing
```

`packages/core` and `packages/ui` have no build step of their own — both are
consumed as raw TypeScript source (`main`/`types` point straight at
`./src/index.ts`); only `apps/web`'s own build compiles anything.

## Why there's a server at all

Every actual PDF and AI feature is client-side — that's the whole point of
the product. `apps/api` exists for exactly one reason: checking Stripe/
Supabase for Pro-tier entitlement, which needs a secret key that can never
live in a browser. It doesn't touch PDFs and never will.

## Local development

```
pnpm install
pnpm dev                # apps/web dev server, http://localhost:5173
pnpm --filter @pdfloom/api dev   # only if working on billing
pnpm dev:desktop         # Tauri desktop shell
```

Requires Node ≥20 and the pnpm version pinned in `package.json`
(`packageManager`, currently `pnpm@11.24.0` — `corepack enable` picks it up
automatically).

`apps/web` needs three `VITE_*` env vars for the account/billing UI to do
anything (core editing needs none of them) — copy `apps/web/.env.example`
to `apps/web/.env.local` and fill in a Supabase project's URL + publishable
key, plus the API URL you're running against.

## Verifying changes

```
pnpm run typecheck                          # packages/core + packages/ui strict typecheck
cd apps/web && node_modules/.bin/tsc -b --noEmit   # apps/web's own project-reference typecheck
cd apps/web && node_modules/.bin/playwright test --reporter=list --grep-invert "real local AI model"
```

Both typecheck commands catch different classes of error (project-reference
issues vs. each package's own strict flags like `noUncheckedIndexedAccess`)
— run both, not just one. The Playwright suite is real browser automation
against real PDFs, not mocked.

## Deploying

Every deploy is manual (`workflow_dispatch`), never automatic on push:

| Workflow | What it does |
|---|---|
| `deploy-web.yml` | Builds and deploys `apps/web` to Azure Static Web Apps |
| `deploy-api.yml` | Builds and deploys `apps/api` to Azure App Service |
| `release-desktop.yml` | Builds Windows/macOS(universal)/Linux installers, publishes a **draft** GitHub Release |
| `publish-downloads.yml` | Takes an already-built release and pushes its installers to public Blob Storage (`pdfloomdownloads`), so anonymous visitors can download without needing repo access |

`release-desktop.yml` and `publish-downloads.yml` build/run on macOS and
Windows GitHub-hosted runners, which are billed well above the free Linux
rate on a private repo — if Actions minutes are exhausted, temporarily
flipping the repo public (unlimited free minutes on public repos) and back
afterward is the known workaround; see [PRD.md](PRD.md) for what that
visibility change does and doesn't expose.

## License

No license file exists yet — this repo is currently all-rights-reserved by
default, regardless of its public/private visibility at any given moment.
