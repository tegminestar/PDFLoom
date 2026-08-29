import type { OutlineNode } from "@pdfloom/core";
import { Panel, cn } from "@pdfloom/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

function OutlineEntry({ node, depth, onNavigate }: { node: OutlineNode; depth: number; onNavigate: (page: number) => void }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.items.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded-[--radius-sm] py-1 pr-2 hover:bg-surface-hover"
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
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);
  const setActivePanel = useLoomStore((s) => s.setActivePanel);

  return (
    <Panel title="Bookmarks" onClose={() => setActivePanel(null)} width={240}>
      {outline.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-text-faint">
          This document has no bookmarks.
        </p>
      ) : (
        outline.map((node, i) => (
          <OutlineEntry key={`${node.title}-${i}`} node={node} depth={0} onNavigate={setCurrentPage} />
        ))
      )}
    </Panel>
  );
}
