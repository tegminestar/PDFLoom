# Security

## Reporting a vulnerability

If you find a security issue in PDFLoom, please report it privately rather
than opening a public GitHub issue. Open an issue only for non-sensitive
reports (e.g. a dependency advisory that's already public).

## How dependencies are monitored

- **GitHub Dependabot** is enabled (`.github/dependabot.yml`) — weekly scans
  of npm and GitHub Actions dependencies, grouped into production/dev PRs.
- **CI gate**: every push and pull request runs `pnpm audit --audit-level
  high` (`.github/workflows/ci.yml`). A new high/critical advisory with a
  known fix fails the build until it's addressed.
- Advisories with no fix available yet are excepted explicitly by GHSA ID
  (never blanket-ignored), with the reasoning recorded next to the
  exception — see `pnpm-workspace.yaml`'s `overrides` and the `--ignore`
  flags in the CI/deploy workflows.

## Current accepted-risk items

- **`image-size` (via `pptxgenjs`)** — GHSA-w3rx-r6r6-pgpr /
  GHSA-5p2g-fcmc-qvqq: the ICNS/JXL/HEIF parsers can infinite-loop on a
  crafted file. No patched release exists yet. Not exploitable in this
  app: the only caller (`apps/web/src/features/quick-create/export.ts`)
  only ever passes a PNG data URL this app renders itself — the vulnerable
  parsers are never reached. Re-evaluate if PPTX export ever accepts a
  user-supplied image file.
- **`glib` (desktop, Linux only)** — advisory affecting `< 0.20.0`; pinned
  at `0.18.5` transitively by Tauri's `gtk` dependency (`gtk 0.18.x`
  requires `glib ^0.18`). Not fixable from this repo until Tauri ships a
  release built against a newer `gtk`/`glib`. Tracked via Dependabot.

## Security model

PDFLoom's web app does all PDF editing and AI inference client-side, in
the browser — a user's document is never uploaded to a server. This means
most classic server-side data-exposure risks (a breach exposing stored
documents, a document visible to other tenants, etc.) don't apply to the
core editing product by construction. `apps/api` is a separate, smaller
surface for the handful of things disclosed on
[/trust](https://pdfloom.app/trust) — billing, multi-party signature
compositing, the feedback relay, and self-hosted usage analytics — and it
never sees the content of a document being edited outside the signing
flow (the one place a file briefly exists server-side at all, and only
between its owner and the specific people they've named as signers).

Analytics specifically: event data (`analytics_events`) never stores a
raw IP address, only what's momentarily derived from it (coarse country/
city via `geoip-lite`); it carries no cookie, device fingerprint, or
cross-session identifier. The `/api/analytics/summary` and
`/api/analytics/is-owner` endpoints are gated to one Supabase account via
a server-only `ANALYTICS_OWNER_EMAIL` — never shipped to the browser
bundle, mirroring how the feedback relay's recipient address is kept
server-only.
