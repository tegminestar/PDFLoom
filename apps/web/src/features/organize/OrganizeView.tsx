import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, IconButton, ScrollArea, Separator, toast } from "@pdfloom/ui";
import {
  Copy,
  Crop,
  FilePlus2,
  FileUp,
  Grid2x2,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLoomStore } from "../../app/store";
import { CropDialog } from "./CropDialog";
import { NUpDialog } from "./NUpDialog";
import { OrganizePageTile, type DropEdge } from "./OrganizePageTile";
import { reorderByEdge } from "./reorder";
import { ResizeDialog } from "./ResizeDialog";
import { SplitDialog } from "./SplitDialog";

export function OrganizeView() {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const storage = useLoomStore((s) => s.storage);
  const setMainView = useLoomStore((s) => s.setMainView);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ pageNumber: number; edge: DropEdge } | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
  const [nUpDialogOpen, setNUpDialogOpen] = useState(false);
  const lastClickedRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageNumbers = useMemo(
    () => (meta ? Array.from({ length: meta.pageCount }, (_, i) => i + 1) : []),
    [meta],
  );

  const toggleSelect = useCallback((pageNumber: number, event: MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (event.shiftKey && lastClickedRef.current !== null) {
        const [lo, hi] = [lastClickedRef.current, pageNumber].sort((a, b) => a - b);
        for (let p = lo; p <= hi; p++) next.add(p);
        return next;
      }
      if (next.has(pageNumber)) next.delete(pageNumber);
      else next.add(pageNumber);
      lastClickedRef.current = pageNumber;
      return next;
    });
  }, []);

  const runMutation = useCallback(
    async (label: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>) => {
      if (!doc) return;
      setIsProcessing(true);
      try {
        const bytes = await doc.getRawBytes();
        const newBytes = await fn(bytes);
        await applyPdfMutation(newBytes);
        setSelected(new Set());
        toast.success(label);
      } catch (error) {
        toast.error(`Couldn't complete: ${label}`, error instanceof Error ? error.message : undefined);
      } finally {
        setIsProcessing(false);
      }
    },
    [doc, applyPdfMutation],
  );

  const handleRotate = (delta: 90 | -90) =>
    runMutation(delta === 90 ? "Rotated pages clockwise" : "Rotated pages counter-clockwise", async (bytes) => {
      const client = await getPdfWorkerClient();
      const indices = [...selected].map((p) => p - 1);
      return client.rotatePages(bytes, indices, delta);
    });

  const handleDelete = () =>
    runMutation(`Deleted ${selected.size} page${selected.size === 1 ? "" : "s"}`, async (bytes) => {
      const client = await getPdfWorkerClient();
      const indices = [...selected].map((p) => p - 1);
      return client.deletePages(bytes, indices);
    });

  const handleDuplicate = () => {
    const [only] = selected;
    if (selected.size !== 1 || only === undefined) return;
    return runMutation("Duplicated page", async (bytes) => {
      const client = await getPdfWorkerClient();
      return client.duplicatePage(bytes, only - 1);
    });
  };

  const handleInsertBlank = () => {
    const insertAt = selected.size > 0 ? Math.max(...selected) : (meta?.pageCount ?? 0);
    return runMutation("Inserted a blank page", async (bytes) => {
      const client = await getPdfWorkerClient();
      return client.insertBlankPage(bytes, insertAt);
    });
  };

  const handleExtract = async () => {
    if (!doc || !meta || selected.size === 0) return;
    setIsProcessing(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const indices = [...selected].sort((a, b) => a - b).map((p) => p - 1);
      const extracted = await client.extractPages(bytes, indices);
      const suggestedName = `${meta.name.replace(/\.pdf$/i, "")}-extracted.pdf`;
      await storage.saveAs(new Uint8Array(extracted), suggestedName);
      toast.success(`Extracted ${selected.size} page${selected.size === 1 ? "" : "s"}`);
    } catch (error) {
      // Cancelling the native save dialog is a normal, expected action —
      // not a failure worth an error toast (saveAs throws AbortError for
      // it rather than resolving, specifically so this is distinguishable
      // from every other kind of failure).
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't extract pages", error instanceof Error ? error.message : undefined);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddFile = () => fileInputRef.current?.click();

  const handleFileChosen = async (file: File) => {
    if (!doc) return;
    const insertAt = meta?.pageCount ?? 0;
    await runMutation(`Added "${file.name}"`, async (bytes) => {
      const client = await getPdfWorkerClient();
      const otherBytes = new Uint8Array(await file.arrayBuffer());
      return client.insertPagesFrom(bytes, otherBytes, insertAt);
    });
  };

  const handleDragStart = useCallback((pageNumber: number) => setDragPage(pageNumber), []);
  const handleDragOverTile = useCallback(
    (pageNumber: number, edge: DropEdge) => setDropTarget((prev) => (prev?.pageNumber === pageNumber && prev.edge === edge ? prev : { pageNumber, edge })),
    [],
  );
  const handleDrop = useCallback(
    (targetPage: number, edge: DropEdge) => {
      const source = dragPage;
      setDragPage(null);
      setDropTarget(null);
      if (source === null || source === targetPage || !meta) return;

      const order = reorderByEdge(pageNumbers, source, targetPage, edge);

      void runMutation("Reordered pages", async (bytes) => {
        const client = await getPdfWorkerClient();
        return client.reorderPages(bytes, order);
      });
    },
    [dragPage, meta, pageNumbers, runMutation],
  );

  if (!doc || !meta) return null;

  const hasSelection = selected.size > 0;

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-4">
        <h1 className="text-sm font-semibold text-text">Organize pages</h1>
        <span className="text-xs text-text-faint">
          {meta.pageCount} pages{hasSelection ? ` · ${selected.size} selected` : ""}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <IconButton
            icon={<RotateCcw />}
            label="Rotate selected counter-clockwise"
            disabled={!hasSelection || isProcessing}
            onClick={() => handleRotate(-90)}
          />
          <IconButton
            icon={<RotateCw />}
            label="Rotate selected clockwise"
            disabled={!hasSelection || isProcessing}
            onClick={() => handleRotate(90)}
          />
          <IconButton
            icon={<Copy />}
            label="Duplicate selected page"
            disabled={selected.size !== 1 || isProcessing}
            onClick={handleDuplicate}
          />
          <IconButton
            icon={<Crop />}
            label="Crop selected page"
            disabled={selected.size !== 1 || isProcessing}
            onClick={() => setCropDialogOpen(true)}
          />
          <IconButton
            icon={<FileUp />}
            label="Extract selected pages as a new PDF"
            disabled={!hasSelection || isProcessing}
            onClick={() => void handleExtract()}
          />
          <IconButton
            icon={<Trash2 />}
            label="Delete selected pages"
            variant="default"
            disabled={!hasSelection || isProcessing || selected.size >= meta.pageCount}
            onClick={handleDelete}
          />
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={handleInsertBlank}>
            <FilePlus2 className="h-4 w-4" />
            Insert blank page
          </Button>
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={handleAddFile}>
            <FileUp className="h-4 w-4" />
            Add pages from file…
          </Button>
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={() => setSplitDialogOpen(true)}>
            <Scissors className="h-4 w-4" />
            Split…
          </Button>
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={() => setResizeDialogOpen(true)}>
            <Maximize2 className="h-4 w-4" />
            Resize…
          </Button>
          <Button variant="secondary" size="sm" disabled={isProcessing} onClick={() => setNUpDialogOpen(true)}>
            <Grid2x2 className="h-4 w-4" />
            Multiple per sheet…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFileChosen(file);
            }}
          />
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Button variant="primary" size="sm" onClick={() => setMainView("read")}>
            Done
          </Button>
          <IconButton icon={<X />} label="Cancel and return to reading" onClick={() => setMainView("read")} showTooltip={false} />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1 p-6">
          {pageNumbers.map((pageNumber) => (
            <OrganizePageTile
              key={pageNumber}
              doc={doc}
              pageNumber={pageNumber}
              selected={selected.has(pageNumber)}
              onToggleSelect={toggleSelect}
              onDragStart={handleDragStart}
              onDragOverTile={handleDragOverTile}
              onDrop={handleDrop}
              dropEdge={dropTarget?.pageNumber === pageNumber ? dropTarget.edge : null}
              isDragging={dragPage === pageNumber}
            />
          ))}
        </div>
      </ScrollArea>

      <SplitDialog open={splitDialogOpen} onOpenChange={setSplitDialogOpen} />
      {selected.size === 1 && (
        <CropDialog open={cropDialogOpen} onOpenChange={setCropDialogOpen} pageNumber={[...selected][0]!} />
      )}
      <ResizeDialog open={resizeDialogOpen} onOpenChange={setResizeDialogOpen} selectedPageNumbers={[...selected]} />
      <NUpDialog open={nUpDialogOpen} onOpenChange={setNUpDialogOpen} selectedPageNumbers={[...selected]} />
    </div>
  );
}
