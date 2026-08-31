import { IconButton, Separator, TopBar, TopBarSection, useTheme } from "@pdfloom/ui";
import {
  BookMarked,
  FileDown,
  FolderOpen,
  ImageDown,
  LayoutGrid,
  Maximize,
  Minimize,
  Moon,
  RotateCw,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";
import { PageNumberField } from "./PageNumberField";
import { ZoomControls } from "./ZoomControls";

function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  return { isFullscreen, toggle };
}

export function Toolbar() {
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const rotateView = useLoomStore((s) => s.rotateView);
  const activePanel = useLoomStore((s) => s.activePanel);
  const toggleActivePanel = useLoomStore((s) => s.toggleActivePanel);
  const closeDocument = useLoomStore((s) => s.closeDocument);
  const openViaPicker = useLoomStore((s) => s.openViaPicker);
  const storage = useLoomStore((s) => s.storage);
  const document_ = useLoomStore((s) => s.document);

  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

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
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
        <IconButton icon={<RotateCw />} label="Rotate view" onClick={() => rotateView(90)} />
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
