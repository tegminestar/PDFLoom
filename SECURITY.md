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
- **`adm-zip` (via `onnxruntime-node`)** — GHSA-vwc7-r8mq-g2x9: zip
  extraction follows destination symlinks, allowing an arbitrary file
  overwrite from a crafted archive. No patched release exists yet. Not
  reachable in this app: `onnxruntime-node`'s native/Node build is
  explicitly disabled (`pnpm-workspace.yaml`'s `allowBuilds`) since every
  AI feature runs on `@huggingface/transformers`' browser/WASM bundle only
  — the package that pulls in `adm-zip` is never actually executed, so its
  zip-extraction code path can't run regardless of the CVE. Medium severity
  (below this repo's `--audit-level high` CI gate), listed here anyway for
  the same completeness reason as the two items above.

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
flow (the one place a file exists server-side at all, and only between
its owner and the specific people they've named as signers). A one-off
signature request's document is deleted along with the rest of the
request's rows once its owner deletes it (there's no separate retention
policy); a saved signature *template*'s document persists until the
owner explicitly deletes that template, since its whole point is being
reused for a new set of signers later — this is a deliberately longer-
lived exception to "temporary," disclosed for the same reason the
one-request case is.

Every signature-request/template endpoint that mutates something is
scoped one of two ways, never a third: owner-authenticated endpoints
(creating, listing, voiding a request; creating, listing, deleting a
template) filter by `owner_id` against the caller's own Supabase session,
so one owner can never see or touch another's; the public signer-facing
endpoints (viewing a signer's own fields, submitting a signature,
declining) are scoped entirely by the unguessable per-signer
`access_token` in the URL, never by anything the client claims about
itself — sequential signing order in particular is re-checked
server-side on every submit, not just trusted from what the signer's own
page last rendered.

Analytics specifically: event data (`analytics_events`) never stores a
raw IP address, only what's momentarily derived from it (coarse country/
city via `geoip-lite`); it carries no cookie, device fingerprint, or
cross-session identifier. The `/api/analytics/summary` and
`/api/analytics/is-owner` endpoints are gated to one Supabase account via
a server-only `ANALYTICS_OWNER_EMAIL` — never shipped to the browser
bundle, mirroring how the feedback relay's recipient address is kept
server-only.

The dashboard also exposes account-management mutations — granting or
revoking another account's read-only access to `/analytics`
(`profiles.role`), a manual Pro-entitlement override independent of
Stripe, and account deletion. All three require the strict
`ANALYTICS_OWNER_EMAIL` check regardless of the caller's own `role` —
an account promoted to `role: 'admin'` can view the dashboard but can
never call any of these endpoints itself, so granting view access can't
be chained into granting more of it. The delete endpoint additionally
refuses to delete the caller's own account, so this panel can never be
used to lock the owner out.
