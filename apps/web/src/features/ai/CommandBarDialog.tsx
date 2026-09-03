import {
  buildCommandPrompt,
  describeCommand,
  extractJsonObject,
  getPdfWorkerClient,
  isChatAvailable,
  preloadChatModel,
  sendChatMessage,
  validateCommand,
  type CommandOperation,
} from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";

/**
 * Natural-language command bar: type a request, a small local chat model
 * (WebLLM, same engine as ChatDialog) resolves it to one of a small,
 * curated set of real document operations (command-bar.ts), which is
 * shown back to the user as a plain-language confirmation BEFORE anything
 * runs — a ~360M-parameter local model's interpretation of an ambiguous
 * request is worth a human's final say, especially for something that
 * mutates the document (see command-bar.ts's docstring for why the
 * operation set is deliberately small rather than "everything the app
 * can do").
 */
export function CommandBarDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pending, setPending] = useState<{ command: CommandOperation; description: string } | null>(null);
  const [understandError, setUnderstandError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAvailability("checking");
    let cancelled = false;
    void isChatAvailable().then((available) => {
      if (!cancelled) setAvailability(available ? "available" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Same ~360MB WebLLM engine as ChatDialog, and the two share its
  // module-level cache — start it here too so opening the command bar
  // first doesn't leave the user waiting on a cold download.
  useEffect(() => {
    if (availability === "available") void preloadChatModel();
  }, [availability]);

  const handleResolve = async () => {
    if (!request.trim() || !meta) return;
    setIsResolving(true);
    setPending(null);
    setUnderstandError(null);
    try {
      const reply = await sendChatMessage(buildCommandPrompt(request.trim(), meta.pageCount), {
        onProgress: (info) => {
          if (info.stage === "loading-model") setStatus(`Loading AI model… ${info.progressText}`);
          else if (info.stage === "ready") setStatus("Understanding your request…");
        },
      });
      const parsed = extractJsonObject(reply);
      const result = validateCommand(parsed, meta.pageCount);
      if (!result.valid) {
        setUnderstandError(result.reason);
      } else {
        setPending({ command: result.command, description: describeCommand(result.command) });
      }
    } catch (error) {
      toast.error("Couldn't process that request", error instanceof Error ? error.message : undefined);
    } finally {
      setIsResolving(false);
      setStatus(null);
    }
  };

  const handleConfirm = async () => {
    if (!pending || !doc) return;
    setIsRunning(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await doc.getRawBytes();
      const command = pending.command;
      let result: Uint8Array;
      switch (command.operation) {
        case "rotatePages": {
          const indices = command.pages === "all" ? Array.from({ length: meta!.pageCount }, (_, i) => i) : command.pages.map((p) => p - 1);
          result = await client.rotatePages(bytes, indices, command.degrees);
          break;
        }
        case "deletePages":
          result = await client.deletePages(bytes, command.pages.map((p) => p - 1));
          break;
        case "duplicatePage":
          result = await client.duplicatePage(bytes, command.page - 1);
          break;
        case "insertBlankPage":
          result = await client.insertBlankPage(bytes, command.atPage - 1);
          break;
        case "addTextWatermark":
          result = await client.addTextWatermark(bytes, { text: command.text });
          break;
      }
      await applyPdfMutation(result);
      toast.success("Done", pending.description);
      onOpenChange(false);
      setPending(null);
      setRequest("");
    } catch (error) {
      toast.error("Couldn't run that command", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI command bar"
      description="Describe what you want done in plain language — a small local AI model turns it into one document command for you to confirm."
      width={480}
      footer={
        pending ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setPending(null)} disabled={isRunning}>
              Back
            </Button>
            <Button variant="primary" size="sm" disabled={isRunning} onClick={() => void handleConfirm()}>
              {isRunning ? "Running…" : "Confirm"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="ai" size="sm" disabled={availability !== "available" || isResolving || !request.trim()} onClick={() => void handleResolve()}>
              {isResolving ? "Understanding…" : "Understand"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {availability === "unavailable" && (
          <p className="rounded-[--radius-md] border border-border bg-surface p-3 text-sm text-text-muted">
            This browser/device doesn't support WebGPU, which the AI command bar requires. Every other PDFLoom AI feature still works here — and every
            command it can run is also available directly from the rail/menus.
          </p>
        )}

        {!pending && (
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleResolve();
            }}
            disabled={availability !== "available" || isResolving}
            placeholder='e.g. "rotate page 3 clockwise", "delete pages 2 and 5"'
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring] disabled:opacity-50"
          />
        )}

        {status && <p className="text-xs text-ai">{status}</p>}
        {understandError && <p className="text-sm text-danger">{understandError} Try rephrasing, or use the rail/menus directly.</p>}

        {pending && (
          <div className="flex items-start gap-2 rounded-[--radius-md] border border-ai/40 bg-ai-muted p-3 text-sm text-text">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
            <span>{pending.description}</span>
          </div>
        )}

        <p className="text-xs text-text-faint">Can rotate/delete/duplicate pages, insert a blank page, and add a text watermark. Nothing runs until you confirm.</p>
      </div>
    </Dialog>
  );
}
