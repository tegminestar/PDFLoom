import {
  PdfDocument,
  buildRagSystemPrompt,
  chunkPagesForRag,
  embedChunks,
  embedQuery,
  findRelevantChunks,
  isChatAvailable,
  preloadChatModel,
  preloadEmbeddingModel,
  sendChatMessage,
  type ChatMessage,
  type EmbeddedChunk,
} from "@pdfloom/core";
import { Button, Dialog, IconButton, toast } from "@pdfloom/ui";
import { FileText, Files, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatSource {
  id: string;
  name: string;
  pageCount: number;
  pages: { pageNumber: number; text: string }[];
}

const RETRIEVAL_TOP_K = 6; // higher than the single-doc chat's 4 — spreading retrieval across more sources needs more slots so no one document crowds out the rest.
const MAX_HISTORY_MESSAGES = 2;

/**
 * "Chat across documents" — the same local, retrieval-augmented Q&A as
 * ChatDialog, but built from an ad-hoc set of PDFs the user picks here
 * rather than the one document open in the main editor. Useful for the
 * cross-document questions PDFLoom's target workflows actually raise (does
 * the vendor's response cover every item in the RFP, do these two contract
 * drafts differ on the termination clause) that a single-document chat
 * can't answer.
 *
 * Deliberately does not reuse ensureDocumentText's OCR-fallback: that
 * function is tied to the single document open in useLoomStore (it writes
 * OCR results back via applyPdfMutation) and running full-page OCR against
 * an arbitrary number of picked files here could be slow and surprising.
 * A document with no extractable text is skipped with an explicit toast
 * instead — the fix is the same "Make searchable (OCR)…" step as anywhere
 * else in the app, just not automatic here.
 */
export function MultiDocChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [isAddingFiles, setIsAddingFiles] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const indexRef = useRef<Promise<EmbeddedChunk[]> | null>(null);
  const indexedSourceIdsRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (availability !== "available") return;
    void preloadChatModel();
    void preloadEmbeddingModel();
  }, [availability]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // The retrieval index belongs to whichever exact set of source documents
  // built it — adding or removing one invalidates it, and the conversation
  // (which was grounded in the old set) is cleared with it rather than left
  // answering follow-ups against sources that no longer match.
  const sourceIdsKey = sources.map((s) => s.id).join(",");
  useEffect(() => {
    if (indexedSourceIdsRef.current !== sourceIdsKey) {
      indexRef.current = null;
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey]);

  const handleAddFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setIsAddingFiles(true);
    const added: ChatSource[] = [];
    const skippedNoText: string[] = [];
    const skippedInvalid: string[] = [];
    try {
      for (const file of files) {
        try {
          const doc = await PdfDocument.load(await file.arrayBuffer());
          const pages: { pageNumber: number; text: string }[] = [];
          for (let pageNumber = 1; pageNumber <= doc.pageCount; pageNumber++) {
            pages.push({ pageNumber, text: await doc.getFullPageText(pageNumber) });
          }
          if (!pages.some((p) => p.text.trim())) {
            skippedNoText.push(file.name);
            continue;
          }
          added.push({ id: `${file.name}-${file.size}-${crypto.randomUUID()}`, name: file.name, pageCount: doc.pageCount, pages });
        } catch {
          skippedInvalid.push(file.name);
        }
      }
    } finally {
      setIsAddingFiles(false);
    }
    if (added.length > 0) setSources((prev) => [...prev, ...added]);
    if (skippedNoText.length > 0) {
      toast.warning(
        skippedNoText.length === 1 ? `Skipped "${skippedNoText[0]}"` : `Skipped ${skippedNoText.length} documents`,
        "No selectable text was found — run \"Convert → Make searchable (OCR)…\" on it first, then add it here.",
      );
    }
    if (skippedInvalid.length > 0) {
      toast.error(skippedInvalid.length === 1 ? `Couldn't open "${skippedInvalid[0]}"` : `Couldn't open ${skippedInvalid.length} files`, "Make sure each file is a valid PDF.");
    }
  };

  const handleRemoveSource = (id: string) => setSources((prev) => prev.filter((s) => s.id !== id));

  const ensureIndex = (): Promise<EmbeddedChunk[]> => {
    if (indexRef.current && indexedSourceIdsRef.current === sourceIdsKey) return indexRef.current;
    if (sources.length === 0) return Promise.reject(new Error("Add at least one document first."));

    const promise = (async () => {
      const chunks = sources.flatMap((s) => chunkPagesForRag(s.pages, s.name));
      return embedChunks(chunks, {
        onProgress: (info) => {
          if (info.stage === "loading-model") {
            const d = info.detail;
            setStatus(d.stage === "downloading" ? `Downloading indexing model… ${Math.round(d.progressPct)}%` : "Preparing the indexing model…");
          } else {
            setStatus(`Indexing documents… (${info.index}/${info.total})`);
          }
        },
      });
    })();

    indexRef.current = promise;
    indexedSourceIdsRef.current = sourceIdsKey;
    promise.catch(() => {
      if (indexRef.current === promise) indexRef.current = null;
    });
    return promise;
  };

  // Eagerly build the index once there's something to index, same rationale
  // as ChatDialog: overlap the (potentially slow, multi-document) embedding
  // pass with the user reading/typing instead of only starting it on Send.
  useEffect(() => {
    if (!open || availability !== "available" || sources.length === 0) return;
    ensureIndex().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, availability, sourceIdsKey]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isBusy || sources.length === 0) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setIsBusy(true);
    try {
      const index = await ensureIndex();
      setStatus("Finding relevant passages…");
      const queryEmbedding = await embedQuery(question);
      const relevant = findRelevantChunks(queryEmbedding, index, RETRIEVAL_TOP_K);
      const systemPrompt = buildRagSystemPrompt(relevant);

      const history: ChatMessage[] = messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }));

      setStatus("Thinking…");
      const reply = await sendChatMessage(
        [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: question }],
        {
          onProgress: (info) => {
            if (info.stage === "loading-model") setStatus(`Loading chat model… ${info.progressText}`);
            else if (info.stage === "ready") setStatus("Thinking…");
          },
        },
      );
      setMessages((prev) => [...prev, { role: "assistant", content: reply || "I couldn't generate a response." }]);
    } catch (error) {
      toast.error("Couldn't get a response", error instanceof Error ? error.message : undefined);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsBusy(false);
      setStatus(null);
    }
  };

  const canSend = availability === "available" && sources.length > 0 && !isBusy && input.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Chat across documents"
      description="Ask questions across several PDFs at once — entirely on your device."
      width={600}
      footer={
        <div className="flex w-full items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={availability !== "available" || sources.length === 0 || isBusy}
            placeholder={
              availability !== "available"
                ? "Chat isn't available on this device…"
                : sources.length === 0
                  ? "Add documents below to start…"
                  : "Ask a question across these documents…"
            }
            className="h-9 min-w-0 flex-1 rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) disabled:opacity-50"
          />
          <Button variant="ai" size="sm" disabled={!canSend} onClick={() => void handleSend()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {availability === "unavailable" && (
          <p className="rounded-(--radius-md) border border-border bg-surface p-3 text-sm text-text-muted">
            This browser/device doesn't support WebGPU, which local AI chat requires. Every other PDFLoom AI feature (summarize, translate, smart
            redact, and more) still works here.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Documents in this chat ({sources.length})</span>
            <Button variant="secondary" size="sm" disabled={isAddingFiles} onClick={() => fileInputRef.current?.click()}>
              <Files className="h-3.5 w-3.5" />
              {isAddingFiles ? "Reading…" : "Add PDFs…"}
            </Button>
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => void handleAddFiles(e)} />
          </div>
          {sources.length === 0 ? (
            <p className="rounded-(--radius-md) border border-dashed border-border p-3 text-sm text-text-faint">
              Add two or more PDFs to start — for example, an RFP and a vendor's response, or two contract drafts to compare.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-(--radius-sm) border border-border bg-surface px-2.5 py-1.5 text-sm">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
                  <span className="shrink-0 text-xs text-text-faint">
                    {s.pageCount} {s.pageCount === 1 ? "page" : "pages"}
                  </span>
                  <IconButton icon={<X />} label={`Remove ${s.name}`} size="sm" onClick={() => handleRemoveSource(s.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div ref={scrollRef} className="flex max-h-72 min-h-[100px] flex-col gap-3 overflow-y-auto">
          {messages.length === 0 && availability === "available" && sources.length > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-text-faint">
              <Sparkles className="h-3.5 w-3.5" /> Ask anything across these documents — answers are grounded in their actual text and cite which one they came from.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 rounded-(--radius-md) bg-primary/15 px-3 py-2 text-sm text-text"
                  : "mr-8 rounded-(--radius-md) border border-ai/40 bg-ai-muted px-3 py-2 text-sm text-text"
              }
            >
              {m.content}
            </div>
          ))}
        </div>

        {status && <p className="text-xs text-ai">{status}</p>}
        {availability === "available" && (
          <p className="text-xs text-text-faint">
            Uses a small local model (~360MB, downloads once) — answers can still be incomplete or wrong. Scanned documents with no selectable text
            aren't OCR'd automatically here; run OCR on them first, then add them.
          </p>
        )}
      </div>
    </Dialog>
  );
}
