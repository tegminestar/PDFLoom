import { IconButton, Panel, cn } from "@pdfloom/ui";
import { ChevronDown, ChevronUp, Loader2, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLoomStore } from "../../app/store";

export function SearchPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchQuery = useLoomStore((s) => s.searchQuery);
  const searchResults = useLoomStore((s) => s.searchResults);
  const isSearching = useLoomStore((s) => s.isSearching);
  const activeSearchIndex = useLoomStore((s) => s.activeSearchIndex);
  const runSearch = useLoomStore((s) => s.runSearch);
  const goToSearchIndex = useLoomStore((s) => s.goToSearchIndex);
  const setActivePanel = useLoomStore((s) => s.setActivePanel);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const goPrev = () => {
    if (searchResults.length === 0) return;
    goToSearchIndex((activeSearchIndex - 1 + searchResults.length) % searchResults.length);
  };
  const goNext = () => {
    if (searchResults.length === 0) return;
    goToSearchIndex((activeSearchIndex + 1) % searchResults.length);
  };

  return (
    <Panel title="Search" onClose={() => setActivePanel(null)} width={280}>
      <div className="flex flex-col gap-2 p-1">
        <div className="flex items-center gap-1.5 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 py-1.5">
          {isSearching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-text-faint" />
          )}
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => void runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.shiftKey ? goPrev() : goNext();
            }}
            placeholder="Search in document…"
            className="w-full min-w-0 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
        </div>

        {searchQuery && (
          <div className="flex items-center justify-between px-1 text-xs text-text-muted">
            <span>
              {searchResults.length === 0
                ? isSearching
                  ? "Searching…"
                  : "No results"
                : `${activeSearchIndex + 1} of ${searchResults.length}`}
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton icon={<ChevronUp />} label="Previous match" size="sm" onClick={goPrev} showTooltip={false} />
              <IconButton icon={<ChevronDown />} label="Next match" size="sm" onClick={goNext} showTooltip={false} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        {searchResults.map((match, i) => (
          <button
            key={`${match.pageNumber}-${match.startIndex}`}
            type="button"
            onClick={() => goToSearchIndex(i)}
            className={cn(
              "rounded-[--radius-sm] px-2.5 py-2 text-left text-xs leading-snug",
              i === activeSearchIndex ? "bg-ai-muted text-text" : "text-text-muted hover:bg-surface-hover",
            )}
          >
            <div className="mb-0.5 font-medium text-text-faint">Page {match.pageNumber}</div>
            {match.contextSnippet}
          </button>
        ))}
      </div>
    </Panel>
  );
}
