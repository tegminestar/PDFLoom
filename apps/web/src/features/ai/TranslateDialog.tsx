import { TRANSLATION_LANGUAGES, translateText, type TranslateResult, type TranslationLanguage } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useLoomStore } from "../../app/store";
import { ensureDocumentText } from "./ensureDocumentText";

type RangeMode = "all" | "current";

/**
 * Translates the open document's text (English source only, see
 * translate.ts) with a small local MarianMT model per target language —
 * runs entirely in-browser, no upload, no API key. Mirrors
 * SummarizeDialog's structure (scope toggle, live progress, copy result).
 */
export function TranslateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);

  const [range, setRange] = useState<RangeMode>("current");
  const [language, setLanguage] = useState<TranslationLanguage>(TRANSLATION_LANGUAGES[0]!);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRun = async () => {
    if (!doc || !meta) return;
    setIsRunning(true);
    setResult(null);
    setCopied(false);
    try {
      const pageNumbers = range === "all" ? Array.from({ length: meta.pageCount }, (_, i) => i + 1) : [currentPage];
      const { text: fullText, ranOcr } = await ensureDocumentText(pageNumbers, setStatus);

      if (!fullText.trim()) {
        toast.warning("No extractable text", "OCR ran automatically but didn't recognize any text on this page — it may be blank or too low-quality to read.");
        return;
      }
      if (ranOcr) {
        toast.success("Ran OCR automatically", "This page had no selectable text, so it was recognized (English) before translating.");
      }

      setStatus("Preparing the AI model…");
      const translated = await translateText(fullText, language, {
        onProgress: (info) => {
          if (info.stage === "loading-model") {
            const d = info.detail;
            setStatus(d.stage === "downloading" ? `Downloading ${language.label} model… ${Math.round(d.progressPct)}%` : "Preparing the AI model…");
          } else if (info.stage === "translating-part") {
            setStatus(info.totalParts > 1 ? `Translating part ${info.part} of ${info.totalParts}…` : "Translating…");
          }
        },
      });
      setResult(translated);
    } catch (error) {
      toast.error("Couldn't translate this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setStatus(null);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Translate"
      description="A small AI model translates the document's text from English — entirely on your device, no upload, no API key."
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" size="sm" disabled={isRunning} onClick={() => void handleRun()}>
            {isRunning ? "Translating…" : result ? "Translate again" : "Translate"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Translate to
          <select
            value={language.code}
            onChange={(e) => setLanguage(TRANSLATION_LANGUAGES.find((l) => l.code === e.target.value) ?? TRANSLATION_LANGUAGES[0]!)}
            disabled={isRunning}
            className="h-8 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-sm text-text outline-none"
          >
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Scope</span>
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {(["current", "all"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRange(m)}
                disabled={isRunning}
                className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${range === m ? "bg-ai text-ai-text" : "text-text-muted hover:text-text"}`}
              >
                {m === "current" ? "Current page" : "Whole document"}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-text-faint">Assumes the source text is in English. The {language.label} model downloads once and is cached for offline reuse afterward.</p>

        {status && <p className="text-xs text-ai">{status}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">Translation</span>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center gap-1 rounded-[--radius-sm] px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[--radius-md] border border-border bg-surface p-3 text-sm leading-relaxed text-text">{result.translatedText}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
