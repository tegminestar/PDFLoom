import { getPdfWorkerClient, type OutlineNode } from "@pdfloom/core";
import { IconButton, Panel, toast, cn } from "@pdfloom/ui";
import { BookmarkPlus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLoomStore } from "../../app/store";

function OutlineEntry({
  node,
  depth,
  onNavigate,
  editControls,
}: {
  node: OutlineNode;
  depth: number;
  onNavigate: (page: number) => void;
  /** Only ever passed for top-level entries PDFLoom itself added this session — see OutlinePanel. */
  editControls?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.items.length > 0;

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded-(--radius-sm) py-1 pr-1 hover:bg-surface-hover"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-text-faint hover:text-text"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          disabled={node.pageNumber === null}
          onClick={() => node.pageNumber !== null && onNavigate(node.pageNumber)}
          className="min-w-0 flex-1 truncate text-left text-sm text-text-muted hover:text-text disabled:cursor-default disabled:text-text-faint disabled:hover:text-text-faint"
          title={node.title}
        >
          {node.title || "Untitled"}
        </button>
        {editControls && <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{editControls}</div>}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.items.map((child, i) => (
            <OutlineEntry key={`${child.title}-${i}`} node={child} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OutlinePanel() {
  const outline = useLoomStore((s) => s.outline);
  const document = useLoomStore((s) => s.document);
  const currentPage = useLoomStore((s) => s.currentPage);
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);
  const setActivePanel = useLoomStore((s) => s.setActivePanel);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [isAdding, setIsAdding] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Top-level positions of bookmarks PDFLoom itself added this session —
  // the only ones safe to rename/delete (see addOutlineEntry's docstring:
  // pdf.js's read side and pdf-lib's write side share no node identity, so
  // targeting a bookmark that came with the file risks editing the wrong
  // one on an unusually-structured document). Reset for free by App.tsx
  // keying this component on meta.id, remounting it fresh whenever the
  // open document changes — lost on reopen, same as any other
  // in-session-only state.
  const [editableIndices, setEditableIndices] = useState<Set<number>>(new Set());
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const startAdding = () => {
    setTitleInput(`Page ${currentPage}`);
    setIsAdding(true);
  };

  const commitAdd = async () => {
    const title = titleInput.trim();
    setIsAdding(false);
    if (!title || !document) return;
    const newIndex = outline.length;
    setIsSaving(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await document.getRawBytes();
      const newBytes = await client.addOutlineEntry(bytes, title, currentPage - 1);
      await applyPdfMutation(newBytes);
      setEditableIndices((prev) => new Set(prev).add(newIndex));
      toast.success("Bookmark added", `"${title}" now points to page ${currentPage}.`);
    } catch (error) {
      toast.error("Couldn't add the bookmark", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSaving(false);
    }
  };

  const startRenaming = (index: number, currentTitle: string) => {
    setRenameInput(currentTitle);
    setRenamingIndex(index);
  };

  const commitRename = async (index: number) => {
    const title = renameInput.trim();
    setRenamingIndex(null);
    if (!title || !document) return;
    setIsSaving(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await document.getRawBytes();
      const newBytes = await client.renameOutlineEntry(bytes, index, title);
      await applyPdfMutation(newBytes);
    } catch (error) {
      toast.error("Couldn't rename the bookmark", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!document) return;
    setIsSaving(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await document.getRawBytes();
      const newBytes = await client.deleteOutlineEntry(bytes, index);
      await applyPdfMutation(newBytes);
      // Every editable index after the deleted one shifts down by one to
      // match the shorter top-level list; the deleted one drops out.
      setEditableIndices((prev) => {
        const next = new Set<number>();
        for (const i of prev) {
          if (i < index) next.add(i);
          else if (i > index) next.add(i - 1);
        }
        return next;
      });
    } catch (error) {
      toast.error("Couldn't remove the bookmark", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Panel
      title="Bookmarks"
      onClose={() => setActivePanel(null)}
      width={240}
      headerActions={
        <IconButton
          icon={<BookmarkPlus />}
          label={`Add bookmark for page ${currentPage}`}
          size="sm"
          disabled={!document || isSaving}
          onClick={startAdding}
        />
      }
    >
      {isAdding && (
        <div className="border-b border-border p-2">
          <input
            autoFocus
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={() => void commitAdd()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") setIsAdding(false);
            }}
            placeholder="Bookmark title"
            className="h-8 w-full rounded-(--radius-sm) border border-border-strong bg-surface px-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
          />
        </div>
      )}
      {outline.length === 0 && !isAdding ? (
        <p className="px-2 py-4 text-center text-xs text-text-faint">
          This document has no bookmarks. Use the button above to add one for the page you're on.
        </p>
      ) : (
        outline.map((node, i) =>
          renamingIndex === i ? (
            <div key={`${node.title}-${i}`} className="px-2 py-1">
              <input
                autoFocus
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onBlur={() => void commitRename(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") setRenamingIndex(null);
                }}
                placeholder="Bookmark title"
                className="h-7 w-full rounded-(--radius-sm) border border-border-strong bg-surface px-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
              />
            </div>
          ) : (
            <OutlineEntry
              key={`${node.title}-${i}`}
              node={node}
              depth={0}
              onNavigate={setCurrentPage}
              editControls={
                editableIndices.has(i) ? (
                  <>
                    <IconButton icon={<Pencil />} label={`Rename "${node.title}"`} size="sm" disabled={isSaving} onClick={() => startRenaming(i, node.title)} />
                    <IconButton icon={<Trash2 />} label={`Remove "${node.title}"`} size="sm" disabled={isSaving} onClick={() => void handleDelete(i)} />
                  </>
                ) : undefined
              }
            />
          ),
        )
      )}
    </Panel>
  );
}
