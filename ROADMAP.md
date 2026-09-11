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

## Open — in progress or queued

- **Outline/bookmark rename & delete** — v1 only supports adding a new
  bookmark. Rename/delete of *pre-existing* bookmarks is blocked on a real
  constraint: pdf.js (read side) and pdf-lib (write side) are independent
  parsers with no shared node identity, so there's no safe way to map a
  displayed bookmark back to the exact dictionary that produced it on an
  unusually-structured file. Rename/delete of bookmarks *PDFLoom itself
  added this session* is safe to build (tag new entries with a marker on
  write, only ever target marked entries) and is a reasonable next step;
  reorder and editing of foreign/pre-existing bookmarks stays out of scope
  until there's a real shared-identity mechanism.
- **Education & Training templates** — the one template-mega-list category
  not yet built. Most of the ~15 originally-requested items are free-text
  documents (lecture notes, research papers, course syllabi) that don't fit
  the fillable-form pattern and should stay skipped, but a real buildable
  subset was scoped and never implemented: Assignment Cover Sheet, Grade
  Report, Training Certificate, Attendance Sheet, Student Feedback Form,
  Training Evaluation, Scholarship Application, Internship Agreement.
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
