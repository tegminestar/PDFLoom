import { Button, Mark, cn } from "@pdfloom/ui";
import {
  AppWindow,
  Apple,
  ChevronDown,
  Cpu,
  Edit3,
  EyeOff,
  FileOutput,
  FileStack,
  FormInput,
  GitCompare,
  Languages,
  Lock,
  Mail,
  MessageSquareText,
  Mic,
  ScanText,
  ShieldCheck,
  Signature,
  Sparkles,
  Users,
  Wand2,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

const TRUST_BADGES = [
  { icon: ShieldCheck, label: "100% local & private" },
  { icon: Cpu, label: "Free AI, no account" },
  { icon: WifiOff, label: "Works offline" },
];

interface FeatureCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: FileStack,
    title: "Organize",
    description: "Merge, split, reorder, rotate, crop, and extract pages with a drag-and-drop grid.",
  },
  {
    icon: Edit3,
    title: "Edit & annotate",
    description: "Best-effort text and image edits — matched to the surrounding font automatically — highlights, freehand drawing, stamps, and sticky notes.",
  },
  {
    icon: FileOutput,
    title: "Convert",
    description: "PDF to images, images to PDF, Markdown/HTML to PDF, and best-effort Word/Excel/PowerPoint export.",
  },
  {
    icon: FormInput,
    title: "Forms",
    description: "Detect AcroForm fields automatically, or design your own — fill, save, flatten, with required-field validation.",
  },
  {
    icon: Mail,
    title: "Mail merge",
    description: "Fill one copy of a form template per row of a spreadsheet — dozens of personalized PDFs in one pass.",
  },
  {
    icon: Signature,
    title: "Sign",
    description: "Draw, type, or upload a signature, with an optional local integrity hash.",
  },
  {
    icon: Lock,
    title: "Protect",
    description: "Password protection, redaction, permission limits, and metadata sanitization.",
  },
  {
    icon: ScanText,
    title: "OCR",
    description: "Make scanned PDFs searchable with real, in-browser text recognition.",
  },
  {
    icon: GitCompare,
    title: "Compare",
    description: "Visual and text diff between two PDFs to catch what changed.",
  },
  {
    icon: Users,
    title: "Live Review",
    description: "Share a session code and drop synced comment pins with anyone viewing the same document — never the file itself.",
  },
];

interface AiCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const AI_FEATURES: AiCard[] = [
  { icon: Sparkles, title: "Summarize", description: "Condense a page or the whole document in seconds." },
  { icon: EyeOff, title: "Smart redaction", description: "Finds names, emails, and card numbers automatically." },
  { icon: Languages, title: "Translate", description: "In-place translation overlay across seven languages." },
  { icon: MessageSquareText, title: "Chat with your PDF", description: "Ask questions, grounded in the document's own text." },
  { icon: Wand2, title: "Explain this clause", description: "Plain-language explanations for dense contract text." },
  { icon: Mic, title: "Voice-to-fill", description: "Fill out form fields by speaking, using your browser's own speech API." },
];

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: "Will my PDFs be shared with anyone else, or end up somewhere on the internet?",
    answer:
      "No. PDFLoom does all of its editing and AI work locally in your browser — your file is never uploaded to a server, so it's never seen by us, stored anywhere, or mixed in with anyone else's documents. Everything happens on your own device.",
  },
  {
    question: "Is PDFLoom really free?",
    answer:
      "Yes. There's no account, no subscription, and no API key to add — including for the AI features. The app and the AI models it uses both run for free in your browser.",
  },
  {
    question: "Do I need an internet connection to use it?",
    answer:
      "Only to load the app the first time and to download the AI models once. After that, PDFLoom keeps working offline — there's no server round-trip for editing or for AI features like summarize, translate, or chat.",
  },
  {
    question: "How accurate is the AI (summaries, redaction, chat)?",
    answer:
      "It's best-effort and grounded in your document's own text, but AI can still miss things or get details wrong — always review AI-suggested redactions and summaries before relying on them, especially for sensitive or legal documents.",
  },
  {
    question: "What happens to my file when I close the tab?",
    answer:
      "Nothing persists anywhere outside your device. PDFLoom keeps no server-side copy or history — if you want to keep your work, save the file to your computer before closing.",
  },
  {
    question: "Which browsers does PDFLoom support?",
    answer:
      "Any modern Chromium-based browser (Chrome, Edge, Brave) or Firefox. PDFLoom uses standard browser and WebAssembly features to do the editing and AI work on-device — no plugin or extension required.",
  },
];

function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {eyebrow && <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">{eyebrow}</span>}
      <h2 className="font-serif text-3xl font-medium tracking-tight text-text sm:text-4xl">{title}</h2>
      {description && <p className="text-base text-text-muted">{description}</p>}
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh w-full overflow-y-auto bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Mark size={28} className="rounded-[--radius-sm]" />
            <span className="font-serif text-lg font-medium tracking-tight">PDFLoom</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-text-muted sm:flex">
            <a href="#features" className="hover:text-text">
              Features
            </a>
            <a href="#ai" className="hover:text-text">
              AI Suite
            </a>
            <a href="#privacy" className="hover:text-text">
              Privacy
            </a>
            <a href="#faq" className="hover:text-text">
              FAQ
            </a>
            <a href="#desktop" className="hover:text-text">
              Desktop app
            </a>
            <Link to="/trust" className="hover:text-text">
              Trust & security
            </Link>
          </nav>
          <Button asChild variant="primary" size="sm">
            <Link to="/app">Open the app</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-6 py-24 sm:py-32">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60rem 34rem at 18% 0%, color-mix(in srgb, var(--loom-primary) 18%, transparent), transparent 60%), " +
                "radial-gradient(48rem 30rem at 92% 30%, color-mix(in srgb, var(--loom-ai) 14%, transparent), transparent 60%)",
            }}
          />
          <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-8 text-center">
            <h1 className="font-serif text-5xl font-medium leading-[1.05] tracking-tight text-text sm:text-6xl">
              Weave every page.
            </h1>
            <p className="max-w-2xl text-lg text-text-muted sm:text-xl">
              A premium PDF editor with real local AI built in — free, with no account and no API key. Everything
              runs in your browser, so your files never leave your device.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="primary" size="lg">
                <Link to="/app">Open PDFLoom — it's free</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#features">See what's inside</a>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 pt-4">
              {TRUST_BADGES.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-faint">
                  <Icon className="h-4 w-4" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-border px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-6xl flex-col gap-12">
            <SectionHeading
              eyebrow="A full editor"
              title="Everything you'd expect from a premium PDF editor"
              description="Organize, edit, convert, fill forms, sign, and protect documents — all in one place, all client-side."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex flex-col gap-3 rounded-[--radius-lg] border border-border bg-bg-elevated p-5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[--radius-md] bg-primary-muted text-primary">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-text">{title}</h3>
                  <p className="text-sm leading-relaxed text-text-muted">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="ai" className="border-t border-border bg-bg-elevated/40 px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-6xl flex-col gap-12">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-ai" />
              <span className="text-xs font-semibold uppercase tracking-wide text-ai">AI Suite</span>
            </div>
            <SectionHeading
              title="Real AI, running entirely on your device"
              description="No API key, no cloud round-trip, no subscription. Small AI models download once, then work offline — your document never leaves your browser."
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {AI_FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex flex-col gap-3 rounded-[--radius-lg] border border-border bg-bg p-5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[--radius-md] bg-ai-muted text-ai">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-text">{title}</h3>
                  <p className="text-sm leading-relaxed text-text-muted">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="privacy" className="border-t border-border px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="font-serif text-3xl font-medium tracking-tight text-text sm:text-4xl">
              Your files never leave your device
            </h2>
            <p className="text-base leading-relaxed text-text-muted">
              PDFLoom does its editing and its AI inference entirely in your browser — no document, page, or field
              value is ever uploaded to a server. There's no account to create and no data to hand over. Open a
              file, do the work, and close the tab.
            </p>
          </div>
        </section>

        <section id="desktop" className="border-t border-border px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
            <SectionHeading
              eyebrow="Also on desktop"
              title="Prefer a real app? Download PDFLoom"
              description="Same editor, same local-only AI, running as a native app — no browser tab required. Not code-signed yet, so your OS will show a first-run warning; that's expected for a new indie app, not a sign anything's wrong."
            />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="primary" size="lg">
                <a href="https://pdfloomdownloads.blob.core.windows.net/downloads/PDFLoom-latest-setup.exe">
                  <AppWindow className="h-4 w-4" /> Windows
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="https://pdfloomdownloads.blob.core.windows.net/downloads/PDFLoom-latest.dmg">
                  <Apple className="h-4 w-4" /> macOS
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="https://pdfloomdownloads.blob.core.windows.net/downloads/PDFLoom-latest.AppImage">
                  <FileStack className="h-4 w-4" /> Linux (AppImage)
                </a>
              </Button>
            </div>
            <a href="https://github.com/tegminestar/PDFLoom/releases/latest" className="text-xs text-text-faint hover:text-text">
              Other formats (.msi, .deb, .rpm) on the GitHub releases page →
            </a>
          </div>
        </section>

        <section id="faq" className="border-t border-border px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-3xl flex-col gap-12">
            <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />
            <div className="flex flex-col gap-3">
              {FAQS.map(({ question, answer }) => (
                <details
                  key={question}
                  className="group rounded-[--radius-lg] border border-border bg-bg-elevated px-5 py-4 open:pb-5"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-text marker:content-none">
                    {question}
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-text-muted">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-20 sm:py-28">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <h2 className="font-serif text-3xl font-medium tracking-tight text-text sm:text-4xl">
              Ready when you are
            </h2>
            <Button asChild variant="primary" size="lg">
              <Link to="/app">Open PDFLoom</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-text-faint">
            <Mark size={18} className={cn("rounded-[--radius-sm]")} />
            PDFLoom · Weave every page ·{" "}
            <a href="https://tegminestar.com" target="_blank" rel="noreferrer" className="hover:text-text">
              A Tegminestar company
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/trust" className="text-xs text-text-faint hover:text-text">
              Trust & security
            </Link>
            <p className="text-xs text-text-faint">Runs entirely in your browser. No account required.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
