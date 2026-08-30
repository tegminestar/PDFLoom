import { explainClause } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useState } from "react";

/**
 * Explains a highlighted passage in plain language with a small local
 * instruction-tuned model. Opened with the exact text the user selected
 * (see ExplainSelectionToolbar) — there's no document/page picker here,
 * unlike Summarize/Translate, since this always operates on a specific
 * selection, not the whole document.
 */
export function ExplainClauseDialog({ open, onOpenChange, clauseText }: { open: boolean; onOpenChange: (open: boolean) => void; clauseText: string }) {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Auto-run once per newly-opened selection — the text is already chosen
  // by the time this dialog opens, so there's no separate "configure, then
  // run" step like Summarize/Translate have (scope/language pickers).
  useEffect(() => {
    if (!open || !clauseText.trim()) return;
    setResult(null);
    setIsRunning(true);
    let cancelled = false;
    (async () => {
      try {
        const explanation = await explainClause(clauseText, {
          onProgress: (info) => {
            if (cancelled) return;
            if (info.stage === "loading-model") {
              const d = info.detail;
              setStatus(d.stage === "downloading" ? `Downloading AI model… ${Math.round(d.progressPct)}%` : "Preparing the AI model…");
            } else {
              setStatus("Explaining…");
            }
          },
        });
        if (!cancelled) setResult(explanation);
      } catch (error) {
        if (!cancelled) toast.error("Couldn't explain this passage", error instanceof Error ? error.message : undefined);
      } finally {
        if (!cancelled) {
          setIsRunning(false);
          setStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clauseText]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Explain this clause"
      description="A small AI model paraphrases the selected passage in plain language — entirely on your device."
      width={480}
      footer={
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-text">Selected passage</span>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[--radius-md] border border-border bg-surface p-3 text-xs italic leading-relaxed text-text-muted">{clauseText}</p>
        </div>

        {status && <p className="text-xs text-ai">{status}</p>}

        {result && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">In plain language</span>
            <p className="whitespace-pre-wrap rounded-[--radius-md] border border-ai/40 bg-ai-muted p-3 text-sm leading-relaxed text-text">{result}</p>
          </div>
        )}

        <p className="text-xs text-text-faint">
          This is an AI-generated paraphrase to help you understand the general idea — it is <span className="font-medium">not legal advice</span> and may be
          inaccurate or incomplete. For anything that matters, consult a qualified professional.
        </p>
      </div>
    </Dialog>
  );
}
