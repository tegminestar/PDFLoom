import { detectAiCapabilities, isWebgpuAdapterAvailable, summarizeText, type SummarizeResult } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLoomStore } from "../../app/store";

type RangeMode = "all" | "current";

/**
 * Summarizes the open document with a small local model (Xenova/t5-small,
 * ~80MB at the pinned q8 quantization — see summarize.ts for why that
 * model/dtype combination specifically, not a default guess) — runs
 * entirely in the browser via WebGPU/WASM, no upload, no API key. The
 * model downloads once and is cached (Cache API) for offline reuse
 * afterward, same promise as OCR's language packs.
 */
export function SummarizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);

  const [range, setRange] = useState<RangeMode>("all");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SummarizeResult | null>(null);
  const [copied, setCopied] = useState(false);

  const capabilities = useMemo(() => detectAiCapabilities(), []);
  // capabilities.webgpu only reflects whether the API exists, not whether a
  // real adapter is obtainable (seen directly in a sandboxed headless
  // browser) — probe for real before claiming WebGPU speed in the UI. When
  // the API isn't even present there's nothing to probe, so that case is
  // decided during render rather than via an effect + setState.
  const [webgpuReady, setWebgpuReady] = useState<boolean | null>(capabilities.webgpu ? null : false);
  useEffect(() => {
    if (!capabilities.webgpu) return;
    let cancelled = false;
    void isWebgpuAdapterAvailable().then((available) => {
      if (!cancelled) setWebgpuReady(available);
    });
    return () => {
      cancelled = true;
    };
  }, [capabilities.webgpu]);

  const handleRun = async () => {
    if (!doc || !meta) return;
    setIsRunning(true);
    setResult(null);
    setCopied(false);
    try {
      const pageNumbers = range === "all" ? Array.from({ length: meta.pageCount }, (_, i) => i + 1) : [currentPage];
      let fullText = "";
      for (const pageNumber of pageNumbers) {
        setStatus(pageNumbers.length > 1 ? `Reading page ${pageNumber} of ${meta.pageCount}…` : "Reading page…");
        fullText += `${await doc.getFullPageText(pageNumber)}\n\n`;
      }

      if (!fullText.trim()) {
        toast.warning("No extractable text", "This page doesn't have selectable text to summarize — it may be a scanned image. Try running OCR first.");
        return;
      }

      setStatus("Preparing the AI model…");
      const summary = await summarizeText(fullText, {
        onProgress: (info) => {
          if (info.stage === "loading-model") {
            const d = info.detail;
            if (d.stage === "downloading") setStatus(`Downloading AI model… ${Math.round(d.progressPct)}%`);
            else if (d.stage === "initiating") setStatus("Preparing the AI model…");
            else if (d.stage === "ready") setStatus("Summarizing…");
          } else if (info.stage === "summarizing-part") {
            setStatus(`Summarizing part ${info.part} of ${info.totalParts}…`);
          } else if (info.stage === "combining-parts") {
            setStatus("Combining into one summary…");
          }
        },
      });
      setResult(summary);
    } catch (error) {
      toast.error("Couldn't summarize this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setStatus(null);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.summary);
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
      title="Summarize"
      description="A small AI model reads the document and writes a short summary — entirely on your device, no upload, no API key."
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" size="sm" disabled={isRunning} onClick={() => void handleRun()}>
            {isRunning ? "Summarizing…" : result ? "Summarize again" : "Summarize"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Scope</span>
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {(["all", "current"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRange(m)}
                disabled={isRunning}
                className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${range === m ? "bg-ai text-ai-text" : "text-text-muted hover:text-text"}`}
              >
                {m === "all" ? "Whole document" : "Current page"}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-text-faint">
          The AI model (~80MB) downloads once on first use and is cached for offline reuse afterward.
          {webgpuReady === null ? "" : webgpuReady ? " This browser supports WebGPU, so it runs quickly." : " Running on WASM — slower than WebGPU, but works everywhere."}
        </p>

        {status && <p className="text-xs text-ai">{status}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">Summary</span>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center gap-1 rounded-[--radius-sm] px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="whitespace-pre-wrap rounded-[--radius-md] border border-border bg-surface p-3 text-sm leading-relaxed text-text">{result.summary}</p>
            {result.wasChunked && (
              <p className="text-xs text-text-faint">
                This document was long, so it was summarized in {result.chunkCount} parts and then combined into the summary above.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
