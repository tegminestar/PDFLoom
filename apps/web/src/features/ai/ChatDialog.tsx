import {
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
import { Button, Dialog, toast } from "@pdfloom/ui";
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";
import { ensureDocumentText } from "./ensureDocumentText";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
}

const RETRIEVAL_TOP_K = 4;
// Keep only the most recent exchange as prior context — each turn already
// gets fresh retrieval, and this model is small (360M params) with a
// correspondingly small context window; a long accumulated history would
// crowd out the actual retrieved excerpts.
const MAX_HISTORY_MESSAGES = 2;

/**
 * "Chat with your PDF" — retrieval-augmented Q&A over the open document,
 * entirely local: a small sentence-embedding model finds the most relevant
 * passages for each question (rag.ts), then a small local chat model
 * (webllm-chat.ts, WebLLM/WebGPU) answers using only those passages.
 *
 * Unlike every other AI feature in this app, WebLLM has NO WASM fallback —
 * it requires a real WebGPU adapter, not just the API's presence (see the
 * same real-adapter probe every Transformers.js feature already uses).
 * isChatAvailable() is checked before ever attempting to load anything, so
 * an unsupported device gets an immediate, honest "not available" message
 * instead of a doomed download.
 */
export function ChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);

  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Caches the in-flight (not just the resolved) index promise, so a
  // prefetch kicked off on open and a user hitting Send before it finishes
  // await the same download/index work instead of racing two of it.
  const indexRef = useRef<Promise<EmbeddedChunk[]> | null>(null);
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

  // Both models (~360MB chat engine, small embedding model) are big enough
  // that waiting for the user's first question to start the download makes
  // "chat with your PDF" feel slow to open. Kick both off in parallel the
  // moment the dialog confirms chat is actually usable on this device —
  // loadPipeline/loadEngine's own module-level caches make this safe to
  // call again later (handleSend's ensureIndex / sendChatMessage reuse
  // the same in-flight or already-resolved promise, never a second copy).
  useEffect(() => {
    if (availability !== "available") return;
    void preloadChatModel();
    void preloadEmbeddingModel();
  }, [availability]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // A new document was opened — the retrieval index and conversation both
  // belong to whichever document they were built from.
  useEffect(() => {
    indexRef.current = null;
    setMessages([]);
  }, [meta?.id]);

  const ensureIndex = (): Promise<EmbeddedChunk[]> => {
    if (indexRef.current) return indexRef.current;
    if (!doc || !meta) return Promise.reject(new Error("No document is open."));

    const promise = (async () => {
      const allPageNumbers = Array.from({ length: meta.pageCount }, (_, i) => i + 1);
      // pages comes straight from ensureDocumentText's own already-guarded
      // read (see its docstring) rather than a second, separate read pass
      // here — this file used to re-read page-by-page itself after calling
      // it, using the *stale* meta.pageCount captured above and a doc
      // reference with no guard against the document having changed again
      // in the meantime. Reusing its result closes that gap entirely
      // instead of narrowing it.
      const { pages, ranOcr } = await ensureDocumentText(allPageNumbers, setStatus);
      if (ranOcr) toast.success("Ran OCR automatically", "This document had no selectable text, so it was recognized (English) before indexing.");

      const chunks = chunkPagesForRag(pages);
      if (chunks.length === 0) throw new Error("OCR ran automatically but didn't recognize any text in this document — it may be blank or too low-quality to read.");

      return embedChunks(chunks, {
        onProgress: (info) => {
          if (info.stage === "loading-model") {
            const d = info.detail;
            setStatus(d.stage === "downloading" ? `Downloading indexing model… ${Math.round(d.progressPct)}%` : "Preparing the indexing model…");
          } else {
            setStatus(`Indexing document… (${info.index}/${info.total})`);
          }
        },
      });
    })();

    indexRef.current = promise;
    // A failed index (bad OCR, doc closed mid-run) shouldn't be cached
    // forever — clear it so the next Send (or the next eager-prefetch
    // effect run) gets a fresh attempt instead of the same rejection.
    promise.catch(() => {
      if (indexRef.current === promise) indexRef.current = null;
    });
    return promise;
  };

  // Indexing (OCR fallback + embedding every page) is the other big chunk
  // of "chat with PDF feels slow" — it used to only start once the user
  // typed a question and hit Send. Start it the moment the dialog is open
  // on an available, chat-capable document so it's typically already done
  // (or well underway) by the time they finish typing; handleSend's
  // ensureIndex() call below awaits this exact same cached promise instead
  // of duplicating the work.
  useEffect(() => {
    if (!open || availability !== "available" || !doc || !meta) return;
    ensureIndex().catch(() => {
      // Swallow here — handleSend surfaces the same failure to the user
      // via its own toast when they actually try to send a message.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, availability, meta?.id]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isBusy) return;
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
      setMessages((prev) => prev.slice(0, -1)); // Remove the user message that never got answered, so retrying doesn't duplicate it.
    } finally {
      setIsBusy(false);
      setStatus(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Chat with your PDF"
      description="Answers your questions using only what's actually in this document — entirely on your device."
      width={560}
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
            disabled={availability !== "available" || isBusy}
            placeholder={availability === "available" ? "Ask a question about this document…" : "Chat isn't available on this device…"}
            className="h-9 min-w-0 flex-1 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring] disabled:opacity-50"
          />
          <Button variant="ai" size="sm" disabled={availability !== "available" || isBusy || !input.trim()} onClick={() => void handleSend()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {availability === "unavailable" && (
          <p className="rounded-[--radius-md] border border-border bg-surface p-3 text-sm text-text-muted">
            This browser/device doesn't support WebGPU, which local AI chat requires. Every other PDFLoom AI feature (summarize, translate, smart
            redact, and more) still works here.
          </p>
        )}

        <div ref={scrollRef} className="flex max-h-96 min-h-[120px] flex-col gap-3 overflow-y-auto">
          {messages.length === 0 && availability === "available" && (
            <p className="flex items-center gap-1.5 text-sm text-text-faint">
              <Sparkles className="h-3.5 w-3.5" /> Ask anything about this document — answers are grounded in its actual text, not general knowledge.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 rounded-[--radius-md] bg-primary/15 px-3 py-2 text-sm text-text"
                  : "mr-8 rounded-[--radius-md] border border-ai/40 bg-ai-muted px-3 py-2 text-sm text-text"
              }
            >
              {m.content}
            </div>
          ))}
        </div>

        {status && <p className="text-xs text-ai">{status}</p>}
        {availability === "available" && (
          <p className="text-xs text-text-faint">Uses a small local model (~360MB, downloads once) — answers can still be incomplete or wrong. Not a substitute for reading the document yourself.</p>
        )}
      </div>
    </Dialog>
  );
}
