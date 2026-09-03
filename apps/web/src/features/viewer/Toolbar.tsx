import { DropdownMenu, IconButton, Separator, TopBar, TopBarSection, useTheme } from "@pdfloom/ui";
import {
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileDown,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Maximize,
  Minimize,
  Moon,
  Redo2,
  RectangleVertical,
  RotateCw,
  Rows,
  Search,
  Sun,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLoomStore, type ScrollMode } from "../../app/store";
import { PageNumberField } from "./PageNumberField";
import { useFullscreen } from "./useFullscreen";
import { ZoomControls } from "./ZoomControls";

const SCROLL_MODE_ICON: Record<ScrollMode, ReactNode> = {
  continuous: <Rows />,
  single: <RectangleVertical />,
  "two-page": <Columns2 />,
};
const SCROLL_MODE_LABEL: Record<ScrollMode, string> = {
  continuous: "Continuous scrolling",
  single: "Single page",
  "two-page": "Two-page view",
};

export function Toolbar() {
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);
  const scrollMode = useLoomStore((s) => s.scrollMode);
  const setScrollMode = useLoomStore((s) => s.setScrollMode);
  const rotateView = useLoomStore((s) => s.rotateView);
  const activePanel = useLoomStore((s) => s.activePanel);
  const toggleActivePanel = useLoomStore((s) => s.toggleActivePanel);
  const closeDocument = useLoomStore((s) => s.closeDocument);
  const openViaPicker = useLoomStore((s) => s.openViaPicker);
  const storage = useLoomStore((s) => s.storage);
  const document_ = useLoomStore((s) => s.document);
  const undo = useLoomStore((s) => s.undo);
  const redo = useLoomStore((s) => s.redo);
  const canUndo = useLoomStore((s) => s.canUndo);
  const canRedo = useLoomStore((s) => s.canRedo);

  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const pageStep = scrollMode === "two-page" ? 2 : 1;

  const handleExportImage = async () => {
    if (!document_ || !meta) return;
    const canvas = window.document.createElement("canvas");
    await document_.renderPage(currentPage, { canvas, scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${meta.name.replace(/\.pdf$/i, "")}-page-${currentPage}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  const handleSaveCopy = async () => {
    if (!document_ || !meta) return;
    // M0 is view-only (no edit/organize tools yet — those land in later
    // milestones and will produce genuinely new bytes via pdf-lib), so this
    // exports the exact bytes the document was opened from to a
    // user-chosen location: a real, complete "Save As" today.
    const bytes = await document_.getRawBytes();
    try {
      await storage.saveAs(bytes, meta.name);
    } catch (error) {
      // Cancelling the native save dialog is a normal, expected user
      // action (not a failure) — saveAs throws AbortError for it rather
      // than resolving, so this stays silent the same way it always has.
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    }
  };

  return (
    <TopBar>
      <TopBarSection>
        <IconButton icon={<FolderOpen />} label="Open a PDF" onClick={() => void openViaPicker()} shortcut="Ctrl O" />
        {meta && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <IconButton icon={<Undo2 />} label="Undo" onClick={() => void undo()} disabled={!canUndo} shortcut="Ctrl Z" />
            <IconButton icon={<Redo2 />} label="Redo" onClick={() => void redo()} disabled={!canRedo} shortcut="Ctrl Shift Z" />
          </>
        )}
        <Separator orientation="vertical" className="mx-1 h-6" />
        <IconButton
          icon={<LayoutGrid />}
          label="Pages"
          variant={activePanel === "thumbnails" ? "active" : "default"}
          onClick={() => toggleActivePanel("thumbnails")}
        />
        <IconButton
          icon={<BookMarked />}
          label="Bookmarks"
          variant={activePanel === "outline" ? "active" : "default"}
          onClick={() => toggleActivePanel("outline")}
        />
        <IconButton
          icon={<Search />}
          label="Search"
          variant={activePanel === "search" ? "active" : "default"}
          onClick={() => toggleActivePanel("search")}
          shortcut="Ctrl F"
        />
      </TopBarSection>

      <TopBarSection align="center">
        <IconButton
          icon={<ChevronLeft />}
          label="Previous page"
          size="sm"
          onClick={() => setCurrentPage(currentPage - pageStep)}
        />
        <PageNumberField />
        <IconButton
          icon={<ChevronRight />}
          label="Next page"
          size="sm"
          onClick={() => setCurrentPage(currentPage + pageStep)}
        />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
        <IconButton icon={<RotateCw />} label="Rotate view" onClick={() => rotateView(90)} />
        <DropdownMenu
          align="center"
          trigger={<IconButton icon={SCROLL_MODE_ICON[scrollMode]} label={`View mode: ${SCROLL_MODE_LABEL[scrollMode]}`} />}
          items={(["continuous", "single", "two-page"] as const).map((mode) => ({
            id: mode,
            label: SCROLL_MODE_LABEL[mode],
            icon: mode === scrollMode ? <Check /> : SCROLL_MODE_ICON[mode],
            onSelect: () => setScrollMode(mode),
          }))}
        />
      </TopBarSection>

      <TopBarSection align="end">
        {meta && (
          <>
            <span className="mr-1 max-w-[16rem] truncate text-sm text-text-muted" title={meta.name}>
              {meta.name}
            </span>
            <IconButton icon={<ImageDown />} label="Export current page as PNG" onClick={() => void handleExportImage()} />
            <IconButton icon={<FileDown />} label="Save a copy" onClick={() => void handleSaveCopy()} />
          </>
        )}
        <IconButton
          icon={isFullscreen ? <Minimize /> : <Maximize />}
          label={isFullscreen ? "Exit presentation mode" : "Presentation mode"}
          onClick={toggleFullscreen}
        />
        <IconButton
          icon={theme === "dark" ? <Sun /> : <Moon />}
          label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={toggleTheme}
        />
        {meta && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <IconButton icon={<X />} label="Close document" onClick={closeDocument} />
          </>
        )}
      </TopBarSection>
    </TopBar>
  );
}
