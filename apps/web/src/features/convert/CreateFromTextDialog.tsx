import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useRef, useState } from "react";
import { useLoomStore } from "../../app/store";
import { parseHtmlToBlocks } from "./htmlToBlocks";

type SourceMode = "markdown" | "html";

const PLACEHOLDER_MD = `# My document

Write **Markdown** here — headings, *italic*, \`code\`, lists, and more.

- Supports lists
- And basic formatting

Or click "Import a file…" to load a .md, .txt, or .html file.`;

/**
 * Markdown/HTML → PDF. Both modes share one PDF layout engine
 * (blocksToPdf/markdownToPdf in packages/core) — this is a text-only,
 * best-effort converter (headings/paragraphs/lists/code/rules; no images,
 * tables, columns, or CSS-accurate rendering), since there's no
 * headless-browser rendering available purely client-side. When a document
 * is already open, the result is appended as new pages instead of opening
 * as a separate document.
 */
export function CreateFromTextDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const document_ = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const storage = useLoomStore((s) => s.storage);
  const openOpenedFile = useLoomStore((s) => s.openOpenedFile);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [mode, setMode] = useState<SourceMode>("markdown");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasOpenDocument = Boolean(document_ && meta);

  const handleImportFile = async (file: File) => {
    const content = await file.text();
    if (file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm")) setMode("html");
    else setMode("markdown");
    setText(content);
    if (!title) setTitle(file.name.replace(/\.(md|txt|html?|markdown)$/i, ""));
  };

  const handleCreate = async () => {
    if (!text.trim()) return;
    setIsCreating(true);
    try {
      const client = await getPdfWorkerClient();
      const options = title.trim() ? { title: title.trim() } : {};
      const bytes =
        mode === "markdown" ? await client.markdownToPdf(text, options) : await client.blocksToPdf(parseHtmlToBlocks(text), options);

      if (hasOpenDocument && document_ && meta) {
        const merged = await client.mergeDocuments([await document_.getRawBytes(), bytes]);
        await applyPdfMutation(merged);
        toast.success("Added to document", `${meta.name} now includes the new pages.`);
      } else {
        const file = new File([bytes as BlobPart], `${title.trim() || "Untitled"}.pdf`, { type: "application/pdf" });
        const opened = await storage.openFromFile(file);
        await openOpenedFile(opened);
      }
      onOpenChange(false);
      setText("");
      setTitle("");
    } catch (error) {
      toast.error("Couldn't create the PDF", error instanceof Error ? error.message : undefined);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hasOpenDocument ? "Add pages from text" : "Create PDF from text"}
      description="Best-effort text layout — headings, paragraphs, lists, and code; no images or precise page layout."
      width={560}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!text.trim() || isCreating} onClick={() => void handleCreate()}>
            {isCreating ? "Creating…" : hasOpenDocument ? "Add to document" : "Create PDF"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            <button
              type="button"
              onClick={() => setMode("markdown")}
              className={`rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium transition-colors ${mode === "markdown" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              Markdown
            </button>
            <button
              type="button"
              onClick={() => setMode("html")}
              className={`rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium transition-colors ${mode === "html" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              HTML
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            Import a file…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.html,.htm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImportFile(file);
            }}
          />
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title (optional)"
          className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "markdown" ? PLACEHOLDER_MD : "<h1>My document</h1>\n<p>Paste or write HTML here.</p>"}
          rows={12}
          className="resize-y rounded-[--radius-sm] border border-border-strong bg-surface p-3 font-mono text-xs leading-relaxed text-text outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
        />
      </div>
    </Dialog>
  );
}
