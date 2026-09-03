import { useEffect, useState, type KeyboardEvent } from "react";
import { useLoomStore } from "../../app/store";

/** The page-number readout/jump field, shared by the read-mode Toolbar and AnnotateToolbar so page context/navigation is never lost when switching tools. */
export function PageNumberField() {
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);

  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  if (!meta) return null;

  const commit = () => {
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n)) setCurrentPage(n);
    else setPageInput(String(currentPage));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-text-muted">
      <input
        aria-label="Current page"
        value={pageInput}
        onChange={(e) => setPageInput(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-8 w-12 shrink-0 rounded-[--radius-sm] border border-border-strong bg-surface text-center tabular-nums text-text outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
      />
      <span className="text-text-faint">/ {meta.pageCount}</span>
    </div>
  );
}
