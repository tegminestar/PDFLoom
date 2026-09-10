import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, IconButton, Panel, toast } from "@pdfloom/ui";
import { Download, Paperclip, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";

interface Attachment {
  name: string;
  bytes: Uint8Array;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function downloadAttachment(attachment: Attachment): void {
  const blob = new Blob([attachment.bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Lists the files bundled into this document as PDF attachments (see
 * pdf/portfolio.ts) and lets you add more — any file type, not just PDFs.
 * A doc with attachments is a "PDF Portfolio" once it also carries the
 * /Collection catalog entry, which attachFiles sets automatically the
 * first time anything gets attached.
 */
export function AttachmentsPanel() {
  const doc = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const setActivePanel = useLoomStore((s) => s.setActivePanel);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!doc) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void doc
      .listAttachments()
      .then((list) => {
        if (!cancelled) setAttachments(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const handleAddClick = () => fileInputRef.current?.click();

  const handleFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0 || !doc) return;
    setAdding(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const toAttach = await Promise.all(
        [...files].map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type || undefined,
        })),
      );
      const newBytes = await client.attachFiles(bytes, toAttach);
      await applyPdfMutation(newBytes);
      toast.success(files.length === 1 ? `Attached "${files[0]!.name}"` : `Attached ${files.length} files`);
    } catch (error) {
      toast.error("Couldn't attach files", error instanceof Error ? error.message : undefined);
    } finally {
      setAdding(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Panel title="Attachments" onClose={() => setActivePanel(null)} width={260}>
      <div className="flex flex-col gap-3">
        <Button variant="secondary" size="sm" onClick={handleAddClick} disabled={adding || !doc}>
          <Plus className="h-4 w-4" />
          {adding ? "Attaching…" : "Add files"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFilesChosen(e.target.files)}
        />

        {loading ? (
          <p className="px-1 text-xs text-text-faint">Loading…</p>
        ) : attachments.length === 0 ? (
          <p className="px-1 text-xs text-text-faint">
            No files attached. Attached files travel inside this PDF — any file type, opened by anyone who opens the PDF in a portfolio-aware viewer.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {attachments.map((a, i) => (
              <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-[--radius-sm] px-1 py-1.5 hover:bg-surface-hover">
                <Paperclip className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text" title={a.name}>
                    {a.name}
                  </span>
                  <span className="block text-xs text-text-faint">{formatBytes(a.bytes.length)}</span>
                </span>
                <IconButton icon={<Download />} label={`Download ${a.name}`} size="sm" onClick={() => downloadAttachment(a)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
