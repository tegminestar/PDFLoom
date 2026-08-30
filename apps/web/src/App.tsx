import { getPdfWorkerClient } from "@pdfloom/core";
import { CommandPalette, DropdownMenu, Mark, Rail, RailItem, toast, type CommandPaletteGroup } from "@pdfloom/ui";
import {
  BookMarked,
  BookOpen,
  Edit3,
  FileDown,
  FileStack,
  FileUp,
  FolderOpen,
  FormInput,
  Hash,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  Maximize,
  Moon,
  PenTool,
  RotateCw,
  Search,
  Stamp,
  Sun,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLoomStore } from "./app/store";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { AnnotateToolbar } from "./features/annotate/AnnotateToolbar";
import { SelectionMarkupToolbar } from "./features/annotate/SelectionMarkupToolbar";
import { ExportImagesDialog } from "./features/convert/ExportImagesDialog";
import { useImageFilePicker } from "./features/convert/useImageFilePicker";
import { EditToolbar } from "./features/edit/EditToolbar";
import { FormsToolbar } from "./features/forms/FormsToolbar";
import { OrganizeView } from "./features/organize/OrganizeView";
import { HeaderFooterDialog } from "./features/stamps/HeaderFooterDialog";
import { PageNumbersDialog } from "./features/stamps/PageNumbersDialog";
import { WatermarkDialog } from "./features/stamps/WatermarkDialog";
import { OutlinePanel } from "./features/viewer/OutlinePanel";
import { SearchPanel } from "./features/viewer/SearchPanel";
import { ThumbnailsPanel } from "./features/viewer/ThumbnailsPanel";
import { Toolbar } from "./features/viewer/Toolbar";
import { Viewer } from "./features/viewer/Viewer";
import { useTheme } from "@pdfloom/ui";

export function App() {
  const meta = useLoomStore((s) => s.meta);
  const activePanel = useLoomStore((s) => s.activePanel);
  const mainView = useLoomStore((s) => s.mainView);
  const setMainView = useLoomStore((s) => s.setMainView);
  const annotateOpen = useLoomStore((s) => s.annotateOpen);
  const setAnnotateOpen = useLoomStore((s) => s.setAnnotateOpen);
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const setFormFillOpen = useLoomStore((s) => s.setFormFillOpen);
  const editOpen = useLoomStore((s) => s.editOpen);
  const setEditOpen = useLoomStore((s) => s.setEditOpen);
  const document_ = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const openViaPicker = useLoomStore((s) => s.openViaPicker);
  const toggleActivePanel = useLoomStore((s) => s.toggleActivePanel);
  const zoomIn = useLoomStore((s) => s.zoomIn);
  const zoomOut = useLoomStore((s) => s.zoomOut);
  const rotateView = useLoomStore((s) => s.rotateView);
  const { theme, toggleTheme } = useTheme();
  const setActivePanel = useLoomStore((s) => s.setActivePanel);
  const setFitMode = useLoomStore((s) => s.setFitMode);

  const [watermarkOpen, setWatermarkOpen] = useState(false);
  const [headerFooterOpen, setHeaderFooterOpen] = useState(false);
  const [pageNumbersOpen, setPageNumbersOpen] = useState(false);
  const [exportImagesOpen, setExportImagesOpen] = useState(false);
  const [isInsertingImages, setIsInsertingImages] = useState(false);

  const handleInsertImages = async (images: { bytes: Uint8Array; type: "png" | "jpg" }[]) => {
    if (!document_) return;
    setIsInsertingImages(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await client.insertImagePages(await document_.getRawBytes(), document_.pageCount, images, { mode: "auto" });
      await applyPdfMutation(bytes);
      toast.success(`Inserted ${images.length} page${images.length === 1 ? "" : "s"} from images`, "Added to the end of the document.");
    } catch (error) {
      toast.error("Couldn't insert images", error instanceof Error ? error.message : undefined);
    } finally {
      setIsInsertingImages(false);
    }
  };
  const imagePicker = useImageFilePicker((images) => void handleInsertImages(images));

  // Global keyboard shortcuts. These are the same actions advertised in the
  // toolbar tooltips and the command palette — every shortcut shown to the
  // user there must be handled here, or the UI would be advertising
  // behavior that doesn't exist.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      // Cmd/Ctrl+K is the command palette's own shortcut — let it through.
      if (event.key.toLowerCase() === "k") return;

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openViaPicker();
        return;
      }
      if (!meta || mainView !== "read") return;
      switch (event.key) {
        case "f":
        case "F":
          event.preventDefault();
          setActivePanel("search");
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomIn();
          break;
        case "-":
          event.preventDefault();
          zoomOut();
          break;
        case "0":
          event.preventDefault();
          setFitMode("width");
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [meta, mainView, openViaPicker, setActivePanel, zoomIn, zoomOut, setFitMode]);

  const commandGroups: CommandPaletteGroup[] = useMemo(
    () => [
      {
        heading: "File",
        items: [{ id: "open", label: "Open a PDF…", icon: <FolderOpen />, shortcut: "Ctrl O", onSelect: () => void openViaPicker() }],
      },
      ...(meta
        ? ([
            {
              heading: "Tools",
              items: [
                {
                  id: "mode-organize",
                  label: mainView === "organize" ? "Back to reading" : "Organize pages…",
                  icon: <FileStack />,
                  onSelect: () => setMainView(mainView === "organize" ? "read" : "organize"),
                },
                {
                  id: "mode-annotate",
                  label: mainView === "read" && annotateOpen ? "Exit annotate mode" : "Annotate…",
                  icon: <Highlighter />,
                  tone: "ai",
                  onSelect: () => {
                    setMainView("read");
                    setAnnotateOpen(!(mainView === "read" && annotateOpen));
                  },
                },
                {
                  id: "mode-fill-form",
                  label: mainView === "read" && formFillOpen ? "Exit form-fill mode" : "Fill form…",
                  icon: <FormInput />,
                  onSelect: () => {
                    setMainView("read");
                    void setFormFillOpen(!(mainView === "read" && formFillOpen));
                  },
                },
                {
                  id: "mode-edit",
                  label: mainView === "read" && editOpen ? "Exit edit mode" : "Edit text or images…",
                  icon: <Edit3 />,
                  onSelect: () => {
                    setMainView("read");
                    setEditOpen(!(mainView === "read" && editOpen));
                  },
                },
                { id: "watermark", label: "Add watermark…", icon: <PenTool />, onSelect: () => setWatermarkOpen(true) },
                { id: "header-footer", label: "Add header & footer…", icon: <FileStack />, onSelect: () => setHeaderFooterOpen(true) },
                { id: "page-numbers", label: "Page numbers & Bates…", icon: <Hash />, onSelect: () => setPageNumbersOpen(true) },
                { id: "insert-images", label: "Insert images as pages…", icon: <ImagePlus />, onSelect: () => imagePicker.open() },
                { id: "export-images", label: "Export pages as images…", icon: <FileDown />, onSelect: () => setExportImagesOpen(true) },
              ],
            },
            {
              heading: "View",
              items: [
                { id: "panel-pages", label: "Toggle Pages panel", icon: <LayoutGrid />, onSelect: () => toggleActivePanel("thumbnails") },
                { id: "panel-bookmarks", label: "Toggle Bookmarks panel", icon: <BookMarked />, onSelect: () => toggleActivePanel("outline") },
                { id: "panel-search", label: "Search in document", icon: <Search />, shortcut: "Ctrl F", onSelect: () => toggleActivePanel("search") },
                { id: "zoom-in", label: "Zoom in", icon: <ZoomIn />, shortcut: "Ctrl +", onSelect: zoomIn },
                { id: "zoom-out", label: "Zoom out", icon: <ZoomOut />, shortcut: "Ctrl -", onSelect: zoomOut },
                { id: "rotate", label: "Rotate view", icon: <RotateCw />, onSelect: () => rotateView(90) },
                { id: "fullscreen", label: "Presentation mode", icon: <Maximize />, onSelect: () => void document.documentElement.requestFullscreen() },
              ],
            },
          ] satisfies CommandPaletteGroup[])
        : []),
      {
        heading: "Preferences",
        items: [
          {
            id: "toggle-theme",
            label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
            icon: theme === "dark" ? <Sun /> : <Moon />,
            onSelect: toggleTheme,
          },
        ],
      },
    ],
    [
      meta,
      mainView,
      setMainView,
      annotateOpen,
      setAnnotateOpen,
      formFillOpen,
      setFormFillOpen,
      editOpen,
      setEditOpen,
      openViaPicker,
      toggleActivePanel,
      zoomIn,
      zoomOut,
      rotateView,
      theme,
      toggleTheme,
      setWatermarkOpen,
      setHeaderFooterOpen,
      setPageNumbersOpen,
      setExportImagesOpen,
      imagePicker.open,
    ],
  );

  return (
    <div className="flex h-dvh w-dvw overflow-hidden bg-bg text-text">
      {meta && (
        <Rail>
          <Mark size={30} className="mb-2 rounded-[--radius-sm]" />
          <RailItem
            icon={<BookOpen />}
            label="Read"
            active={mainView === "read"}
            onClick={() => setMainView("read")}
          />
          <RailItem
            icon={<FileStack />}
            label="Organize pages"
            active={mainView === "organize"}
            onClick={() => setMainView("organize")}
          />
          <RailItem
            icon={<Highlighter />}
            label="Annotate"
            tone="ai"
            active={mainView === "read" && annotateOpen}
            onClick={() => {
              setMainView("read");
              setAnnotateOpen(!(mainView === "read" && annotateOpen));
            }}
          />
          <RailItem
            icon={<FormInput />}
            label="Fill form"
            active={mainView === "read" && formFillOpen}
            onClick={() => {
              setMainView("read");
              void setFormFillOpen(!(mainView === "read" && formFillOpen));
            }}
          />
          <RailItem
            icon={<Edit3 />}
            label="Edit"
            active={mainView === "read" && editOpen}
            onClick={() => {
              setMainView("read");
              setEditOpen(!(mainView === "read" && editOpen));
            }}
          />
          <DropdownMenu
            align="start"
            trigger={<RailItem icon={<Stamp />} label="Page design" active={watermarkOpen || headerFooterOpen || pageNumbersOpen} />}
            items={[
              { id: "watermark", label: "Add watermark…", icon: <PenTool />, onSelect: () => setWatermarkOpen(true) },
              { id: "header-footer", label: "Add header & footer…", icon: <FileStack />, onSelect: () => setHeaderFooterOpen(true) },
              { id: "page-numbers", label: "Page numbers & Bates…", icon: <Hash />, onSelect: () => setPageNumbersOpen(true) },
            ]}
          />
          <DropdownMenu
            align="start"
            trigger={<RailItem icon={<FileUp />} label="Convert" active={exportImagesOpen} />}
            items={[
              {
                id: "insert-images",
                label: isInsertingImages ? "Inserting…" : "Insert images as pages…",
                icon: <ImagePlus />,
                disabled: isInsertingImages,
                onSelect: () => imagePicker.open(),
              },
              { id: "export-images", label: "Export pages as images…", icon: <FileDown />, onSelect: () => setExportImagesOpen(true) },
            ]}
          />
        </Rail>
      )}
      {imagePicker.input}
      <div className="flex min-h-0 flex-1 flex-col">
        {meta &&
          mainView === "read" &&
          (formFillOpen ? <FormsToolbar /> : annotateOpen ? <AnnotateToolbar /> : editOpen ? <EditToolbar /> : <Toolbar />)}
        <div className="flex min-h-0 flex-1">
          {meta && mainView === "read" && !annotateOpen && !formFillOpen && !editOpen && activePanel === "thumbnails" && <ThumbnailsPanel />}
          {meta && mainView === "read" && !annotateOpen && !formFillOpen && !editOpen && activePanel === "outline" && <OutlinePanel />}
          {meta && mainView === "read" && !annotateOpen && !formFillOpen && !editOpen && activePanel === "search" && <SearchPanel />}
          <div className="min-w-0 flex-1">
            {!meta ? <WelcomeScreen /> : mainView === "organize" ? <OrganizeView /> : <Viewer />}
          </div>
        </div>
      </div>
      <CommandPalette groups={commandGroups} />
      <SelectionMarkupToolbar />
      {meta && (
        <>
          <WatermarkDialog open={watermarkOpen} onOpenChange={setWatermarkOpen} />
          <HeaderFooterDialog open={headerFooterOpen} onOpenChange={setHeaderFooterOpen} />
          <PageNumbersDialog open={pageNumbersOpen} onOpenChange={setPageNumbersOpen} />
          <ExportImagesDialog open={exportImagesOpen} onOpenChange={setExportImagesOpen} />
        </>
      )}
    </div>
  );
}
