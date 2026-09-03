import { Button, Mark } from "@pdfloom/ui";
import { Code, Eye, FileCheck2, Lock, Mail, MessageCircle, ShieldCheck, Signature } from "lucide-react";
import { Link } from "react-router-dom";

interface ExceptionCard {
  icon: typeof Signature;
  title: string;
  whatItDoes: string;
  whatItTouches: string;
  whatItNeverDoes: string;
}

const EXCEPTIONS: ExceptionCard[] = [
  {
    icon: Signature,
    title: "Multi-party signature requests",
    whatItDoes:
      "When you send a document to someone else for signature, a small server-side step composites each signature image onto the PDF as it comes in, then hands each signer their own view of it.",
    whatItTouches:
      "The document's bytes pass through the server only at the moment a signature is being composited — that's the one feature in PDFLoom where this is unavoidable, since collecting a signature from someone who isn't the document's owner requires a shared place for that document to exist.",
    whatItNeverDoes:
      "Signed documents aren't scanned, analyzed, or read by any AI — server access is scoped to the compositing operation itself.",
  },
  {
    icon: MessageCircle,
    title: "The feedback form",
    whatItDoes: "Send Feedback routes your message to our team.",
    whatItTouches: "Only the text you type and an optional reply email — never your document.",
    whatItNeverDoes:
      "The recipient address is kept server-side specifically so it never appears in the page's source or network requests — the form itself never reveals who it's routed to.",
  },
];

function DetailRow({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">{label}</span>
      <p className="text-sm leading-relaxed text-text-muted">{children}</p>
    </div>
  );
}

export function TrustPage() {
  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Mark size={28} className="rounded-[--radius-sm]" />
            <span className="font-serif text-lg font-medium tracking-tight">PDFLoom</span>
          </Link>
          <Button asChild variant="primary" size="sm">
            <Link to="/app">Open the app</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-20 px-6 py-20 sm:py-28">
        <section className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="font-serif text-4xl font-medium tracking-tight text-text sm:text-5xl">Trust & security</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-muted">
            PDFLoom's whole premise is that your files never leave your device. This page is the specific, honest
            account of what that means in practice — including the two places it isn't quite absolute, and why.
          </p>
        </section>

        <section className="flex flex-col gap-8">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-text">What runs entirely on your device</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { icon: FileCheck2, title: "Every editing tool", body: "Organize, edit, annotate, convert, fill forms, redact, sanitize — all of it runs in your browser using WebAssembly, not a server." },
              { icon: Eye, title: "Every AI feature", body: "Summarize, translate, smart redaction, chat with your PDF, OCR — small models download once and run locally. No document text or image is ever sent anywhere for inference." },
              { icon: Lock, title: "Storage", body: "Recent-files history and any saved-to-your-computer copies live only in your browser's own storage or your file system — PDFLoom keeps no server-side copy of anything you open or create." },
              { icon: Mail, title: "Optional sign-in", body: "Creating an account (for Pro features) uses a magic-link email — that email address is the only thing it collects, and it's entirely optional. The free product needs no account at all." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-3 rounded-[--radius-lg] border border-border bg-bg-elevated p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[--radius-md] bg-primary-muted text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <h3 className="text-sm font-semibold text-text">{title}</h3>
                <p className="text-sm leading-relaxed text-text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl font-medium tracking-tight text-text">The two disclosed exceptions</h2>
            <p className="text-sm leading-relaxed text-text-muted">
              Everything else in PDFLoom is local by construction — these are the only two features anywhere in the
              app that route anything through a server at all, and both are scoped as narrowly as the feature allows.
            </p>
          </div>
          <div className="flex flex-col gap-6">
            {EXCEPTIONS.map(({ icon: Icon, title, whatItDoes, whatItTouches, whatItNeverDoes }) => (
              <div key={title} className="flex flex-col gap-5 rounded-[--radius-lg] border border-border bg-bg-elevated p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[--radius-md] bg-ai-muted text-ai">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-base font-semibold text-text">{title}</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <DetailRow label="What it does">{whatItDoes}</DetailRow>
                  <DetailRow label="What touches a server">{whatItTouches}</DetailRow>
                  <DetailRow label="What it never does">{whatItNeverDoes}</DetailRow>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-6 rounded-[--radius-lg] border border-border bg-bg-elevated p-8 text-center">
          <Code className="h-8 w-8 text-text-muted" />
          <h2 className="font-serif text-2xl font-medium tracking-tight text-text">Don't take our word for it</h2>
          <p className="max-w-xl text-sm leading-relaxed text-text-muted">
            PDFLoom's source is public — every claim on this page is something you (or anyone) can go verify directly
            in the code, not just a promise. Found something that looks off? See the reporting process in the repo's
            security policy.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="primary" size="sm">
              <a href="https://github.com/tegminestar/PDFLoom" target="_blank" rel="noreferrer">
                View source on GitHub
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href="https://github.com/tegminestar/PDFLoom/blob/master/SECURITY.md" target="_blank" rel="noreferrer">
                Security policy
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-text-faint">
            <Mark size={18} className="rounded-[--radius-sm]" />
            PDFLoom · Weave every page
          </div>
          <Link to="/" className="text-xs text-text-faint hover:text-text">
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
