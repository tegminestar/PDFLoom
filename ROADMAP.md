# PDFLoom Roadmap

Durable tracking of what's shipped and what's open, so nothing gets dropped
across sessions. Update this file whenever a deferred item is picked up,
scoped, or closed — this is the source of truth, not chat history.

## Shipped (this cycle)

- Per-field signature/initials review on the signer page (was: everything
  signed at once).
- Template library expanded 65 → 121 fillable PDFs (HR & Employment,
  Healthcare & Medical, Financial & Billing, Operations/Project Management,
  Personal & Lifestyle).
- WelcomeScreen: collapsible template categories, denser cards, CSS-3D
  page-stack graphic, gradient icon tiles, drifting background, mobile
  overflow fix.
- Multi-document AI chat ("Chat across documents") — local RAG across an
  ad-hoc set of picked PDFs, with per-document citations.
- PDF Spaces v1: pin recent files (exempt from eviction), tag-based
  organization with a filter chip row.
- Resume last-viewed page on reopen (surfaced and fixed a real
  page-navigation-nonce bug in Viewer.tsx along the way).
- Print (Ctrl/Cmd+P previously did nothing useful — now prints the real PDF
  via a hidden iframe, not a screenshot of app chrome).
- Bookmark editing v1: "Add bookmark" for the current page. Verified
  Smart Redact (local PII/NER detection) already matches or exceeds Foxit's
  equivalent — not a gap, no action needed there.
- Bookmark rename & delete for entries *PDFLoom itself added this
  session* — tracked by top-level position client-side (reset on document
  reopen via a React key, not persisted). Pre-existing/foreign bookmarks
  in a file remain untouched by rename/delete, for the reason below.
- Education & Training templates: the real buildable subset (Assignment
  Cover Sheet, Grade Report, Certificate of Completion, Class Attendance
  Sheet, Student Feedback Form, Training Evaluation, Scholarship
  Application, Internship Agreement) — template library now at 129.
  Free-text items in the original ~15-item category (lecture notes,
  research papers, course syllabi) stay deliberately skipped.

- Desktop shell (Tauri): "Open With PDFLoom" / double-clicking a .pdf
  previously did nothing — no file association was even declared, and the
  app ignored argv entirely, always booting to the WelcomeScreen (or, on
  `/`, the marketing landing page — also fixed, the desktop shell now
  redirects `/` → `/app` since a marketing funnel makes no sense inside an
  already-installed app). Windows/Linux: argv + `tauri-plugin-single-instance`
  (a second launch redirects into the already-running window instead of
  spawning a new one) — built, compiles clean, and the argv-extraction
  logic itself was verified directly (a temporary diagnostic build
  confirmed the right path is extracted from a real launch). macOS/iOS/
  Android: the official `RunEvent::Opened` mechanism, added using the
  same code path across all three.
  **Not fully verified**: this sandboxed environment has no real
  interactive display session, so the packaged app's actual on-screen
  behavior (WebView2 content loading, the file actually opening) could
  not be confirmed end-to-end here — only the Rust-side logic and the
  unaffected web build were verifiable. Needs a real run on an actual
  desktop before being called done. **Known incomplete**: Android's
  `content://` URIs (common when a file is opened from another app or a
  file manager, not always a plain file path) can't be read by the
  current plain-`std::fs::read` command — would need `tauri-plugin-fs`'s
  content-resolver support, not added since it's unverifiable without a
  real Android device/emulator. iOS/Android in general were never built
  or run — no toolchain available in this environment.
- Also found while investigating: an *already-installed* desktop build
  showing "refused to connect, localhost" — root cause is
  `apps/web/src/app/supabase.ts`'s `apiUrl` falling back to
  `http://localhost:8080` when `VITE_API_URL` isn't baked in at build
  time. `release-desktop.yml` already sets that env var correctly for
  the whole build job, so a *fresh* release should not have this problem
  — the installed copy showing it is almost certainly older than that
  fix, or the specific one used to build the desktop app. Confirm on the
  next release rather than assuming this is closed.

## Open — in progress or queued

- **Verify the desktop file-association fix on a real machine** (see
  above) — Windows especially, since that's the platform actually
  reported broken. Trigger `release-desktop.yml` for a fresh build once
  ready (an external, visible action — needs explicit go-ahead, not
  something to trigger automatically).
- **Android/iOS file-association support** — plumbing added per Tauri's
  official mobile guide, but never built, run, or tested on either
  platform (no toolchain here). Needs a session with the right mobile
  build tools, plus `tauri-plugin-fs` (or equivalent) for Android's
  `content://` URI case specifically, before this can be considered done
  for mobile.
- **Outline/bookmark rename & delete of *pre-existing* bookmarks** — still
  blocked on a real constraint: pdf.js (read side) and pdf-lib (write side)
  are independent parsers with no shared node identity, so there's no safe
  way to map a displayed bookmark back to the exact dictionary that
  produced it on an unusually-structured file. No planned fix without a
  real shared-identity mechanism (e.g. a from-scratch outline parser that
  both reads and writes through the same code path).
- **Full PDF/UA structure-tree accessibility tagging** — not a new gap,
  already an explicit documented scope decision in
  `apps/web/src/features/ai/AccessibilityDialog.tsx` (alt-text only, by
  design) — building a correct structure-tree rewriter needs a
  content-stream parser this app doesn't have. Listed here so it stays
  visible, not because it's newly discovered.

## Explicitly out of scope (not bugs, don't re-open without a real reason)

- Cryptographic (PKI/certificate-based) digital signatures — PDFLoom's
  signing is visual-only, disclosed on every signed document. A real
  standing decision, not an oversight.
- Embedded PDF JavaScript execution (form calculations/actions) — security
  surface that doesn't fit the 100%-client-side, no-arbitrary-code-execution
  posture.
- **PDF/A archival export** — explicitly decided against (2026-09-11):
  real compliance needs ICC profile embedding, XMP conformance metadata,
  and verifying every font is embedded, none of which can be validated
  here without a certified validator, and a document that *claims*
  PDF/A compliance without actually meeting it is worse than not claiming
  it. Held off entirely rather than ship an unverified "best-effort"
  version. Revisit only if a concrete need comes up.
