# PDFLoom — Product Requirements

This document has two parts. **Part 1 is a universal standard** — written
generically enough to paste into any other project's own PRD, not specific
to PDFLoom. **Part 2 is PDFLoom's own product requirements**, built on top
of it. Keep that separation when this file is updated: a rule that's
actually project-specific belongs in Part 2, not Part 1.

---

## Part 1 — Universal Engineering Standards

These apply to every project, not just this one.

### 1. No shortcuts

Every feature must be real and working end-to-end before it's considered
done — no TODO stubs, no mocked or fake handlers standing in for real
logic, no hardcoded sample data pretending to be dynamic behavior, no
scaffolding left half-finished. "Looks right in the code" is not the bar;
"actually run it, with real inputs, in a real environment" is.

- If something has an inherent ceiling (a browser API that can't do what a
  native app can, a legal limitation, a third-party constraint), say so
  plainly rather than shipping a fake or half version of it and staying
  quiet about the gap.
- Never leave something partially wired up — a button that doesn't do
  anything yet, a panel with placeholder content. Either it's finished or
  it isn't started; there is no third state to ship.

### 2. Verify by doing, not by reading

Before marking anything done: actually exercise it — real files, a real
browser/runtime, real edge cases (not just the happy path) — not just a
read-through of the diff. When a claim can be tested, test it before
stating it as fact. When it genuinely can't be tested from the current
environment (a missing hardware capability, a real network dependency),
say that explicitly instead of assuming it works.

### 3. Autonomous execution, zero regressions

Once a direction is set, proceed through the full scope of work without
stopping for approval at every step — only interrupt for a genuine
blocker: an architectural fork only the project owner can decide, a
platform limitation that changes what's achievable, or anything
destructive/hard to reverse. Reaching a milestone boundary is not a
stopping point by default; keep going unless told otherwise.

This is paired with, not traded off against, a standing regression bar:
before and after any change, re-verify that previously-working
functionality still works — a new feature must never silently break an
old one. Speed and safety are a joint requirement, not a choice between
them.

### 4. Ship tested state, not untested state

Committing and pushing don't need separate permission each time, as long
as what's being pushed has actually been through verification (typecheck
+ real functional testing) first. The bar is never "ask before every
push" — it's "never push something known to be mid-fix, half-verified, or
failing a check."

### 5. Confirm before hard-to-reverse or externally-visible actions

Local, reversible work (editing files, running tests, iterating in a
sandbox) doesn't need a check-in. Anything that's hard to undo or visible
outside the local environment — deploying, publishing, force-pushing,
deleting, sending a message on someone's behalf, changing a shared
resource's visibility or permissions — gets explicit confirmation first,
every time, even if a similar action was approved once already. Approval
for one instance is not standing approval for the next one.

### 6. Keep a persistent, honest record

Whatever the project's memory/notes mechanism is, keep it current as work
happens — not just what was built, but *why*, what broke and how it was
actually found (not just guessed at), and what's genuinely still open.
Stale documentation that contradicts the real state of the code is worse
than no documentation; correct it the moment it's noticed, not later.

---

## Part 2 — PDFLoom Product Requirements

### Identity

**PDFLoom** — *"Weave every page."* A premium PDF editor with a local-AI
suite, positioned against Adobe Acrobat's premium tier on functionality,
not against free/light PDF tools on price alone.

### Core promise

Every PDF operation and every AI feature runs 100% client-side (WASM/
WebGPU in the browser, or the same code natively via the desktop Tauri
shell). No file is ever uploaded to any server, for any feature, for any
user — free or paying. This is the product's central differentiator and
constrains every feature decision: if something can only be done by
sending the file to a server, it doesn't belong in the core product (see
"Explicitly out of scope" below).

### Target users

Anyone who currently reaches for Adobe Acrobat, SmallPDF, iLovePDF, or
similar, and would rather not pay a subscription or upload documents to a
third party to do it — individuals and small teams handling contracts,
forms, scanned documents, and everyday PDF editing.

### Feature set

- **View & Navigate** — continuous/single/two-page scroll, thumbnails,
  outline, full-text search with precise on-page highlighting, zoom
  (fit-width/fit-page/custom), dark/light theme, presentation mode.
- **Organize** — merge, split, reorder, rotate, delete/insert/extract
  pages, crop, resize/scale, page numbering, N-up imposition.
- **Edit & Annotate** — best-effort direct text/image editing, shapes,
  freehand draw, stamps, comment boxes, links, headers/footers,
  watermarks, redaction (real content removal, not an overlay).
- **Convert** — PDF⇄images, image/Markdown/HTML→PDF, best-effort
  PDF→Office export, compression, OCR for scanned documents.
- **Forms** — field detection, a visual field designer, fill & save,
  flatten, required-field validation, JSON/CSV/FDF import-export, a
  bundled template library, voice-to-fill via the browser's native speech
  API, and mail merge (one filled copy per row of an uploaded spreadsheet).
- **Sign & Certify** — draw/type/upload signatures, placement with real
  resize/move/align before committing, optional local integrity hash —
  explicitly labeled as a visual attestation, not a certified PKI
  signature (see honesty flags below).
- **Protect & Secure** — password protection, permission restrictions,
  metadata/hidden-data sanitization, visual+text document comparison.
- **Review & Collaborate** — session-based Live Review: comment pins
  synced in real time with anyone else viewing the same document (Yjs
  CRDT over a Supabase Realtime channel), without uploading the file
  itself — see the scope note under "Explicitly out of scope" below for
  why this is comments-only, not co-editing.
- **AI Suite** (the differentiator, all local/free/no key) — an AI
  command bar that resolves natural-language requests to real toolbar
  operations, document summarization, PII-aware smart redaction,
  translation, "explain this clause," accessibility alt-text, chat/RAG
  over the open document.
- **Quick Create** — repurpose a document's content into a flyer, social
  graphic, or slide deck via AI-extracted highlights on a template canvas.

### Honesty flags — deliberate, stated ceilings

These are not gaps to silently work around; they're real limits of what's
achievable client-side, and the product says so rather than faking it:

- Text-editing inside complex PDFs is best-effort content-stream patching,
  not a full reflow engine.
- PDF→Office export is best-effort text/table extraction, not
  layout-perfect conversion.
- E-signatures are a visual attestation (+ optional local integrity hash),
  not a certified PKI signature.
- Accessibility tagging covers image alt-text, not full PDF/UA
  structure-tree tagging.

### Architecture

Monorepo (pnpm workspaces) built around one hard boundary: `packages/core`
is framework-agnostic — no React, no direct DOM/window access outside a
small storage-adapter interface — so every shell (`apps/web` today,
`apps/desktop` via Tauri) consumes the exact same engine rather than
reimplementing it. See the [root README](README.md) for the concrete
layout and how to run/test it.

### Monetization

Free tier is not a trial — it's the permanent floor: local editing, local
AI, no account, no server round-trip, for every feature listed above,
forever. Pro is scoped narrowly to things that *structurally* require a
server (this is the actual line, not an arbitrary one): cross-device sync,
real shareable links, send-for-signature tracking, published web forms
collecting submissions, and true multi-person co-editing of a document's
content (Live Review's comment-pin sync is a free, narrower thing — see
the scope note under "Explicitly out of scope"). Core editing stays local
and free even for paying users — Pro unlocks server-dependent
conveniences, it does not relocate where PDF processing happens.

**Currently implemented**: Supabase auth + Stripe Checkout/Billing Portal
gate a Pro flag; no Pro-only *feature* is built yet (no sync, no share
links) — the billing plumbing exists ahead of the features it will
eventually gate. **Desktop downloads are not currently gated at all** —
gating a download behind entitlement is a real, separate build (a signed-
URL check against the existing billing API in front of Blob Storage,
not built yet), not something implied by today's infrastructure choices.

### Explicitly out of scope (for the free/local product)

Anything that structurally needs a server to mean anything for someone
*other* than the file's owner: real-time **co-editing of document
content**, shared team workspaces, published forms that collect other
people's submissions, send-for-signature status tracking. These aren't
missing by oversight — they're the actual, considered definition of what
Pro is for.

**Live Review is a deliberate, narrow exception to this, not a
contradiction of it.** It's free because it's scoped to a shared list of
*comment pins* — position, author, text — never the document's actual
content, which stays exactly as opaque pdf-lib bytes on each participant's
own device the entire time. The line this product draws isn't "no
real-time server involvement, ever" — it's "no server-mediated editing of
the file itself." A Yjs CRDT merging comment metadata satisfies that; two
people's edits merging into one document would not, which is why *that*
(true co-editing) stays a Pro-eventually idea, not something Live Review
quietly backdoors for free.

### Distribution

- **Web**: the primary channel — open the URL, no install. Deployed via
  `deploy-web.yml` to Azure Static Web Apps.
- **Desktop**: Windows/macOS(universal)/Linux installers, unsigned (no
  paid code-signing certificate yet, so OS-level warnings — SmartScreen,
  Gatekeeper — are expected on first run). Built via `release-desktop.yml`
  (creates a draft GitHub Release first, so a build can be checked before
  anyone else can reach it) and published to public Blob Storage via
  `publish-downloads.yml`, deliberately decoupled from GitHub Releases so
  the source repo can stay private while downloads stay public — repo
  visibility and download availability are independent by design.

### Current status

Web app is live at its custom domain, **pdfloom.app** (Cloudflare DNS,
Azure-managed free TLS certificate), verified end-to-end — the original
Azure-assigned hostname also still resolves. Backend billing API is live,
with CORS/Stripe redirect targets pointed at the custom domain. Desktop
installers exist for v0.1.0 and are publicly downloadable. No app-store
submission (Microsoft Store / Mac App Store) — GitHub Releases + Blob
Storage is the only distribution channel today.

**Internal tooling, not a product feature**: a self-hosted `/analytics`
dashboard exists (owner-only, gated to one Supabase account) covering
usage, signups, and feedback — replacing a paid Plausible integration at
zero added infrastructure cost. It's mentioned here for the same honesty-
of-record reason as everything else in this section, not because it's
something end users interact with.
