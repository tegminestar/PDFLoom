import { getPdfWorkerClient } from "@pdfloom/core";
import { CommandPalette, DropdownMenu, Mark, Rail, RailItem, toast, type CommandPaletteGroup } from "@pdfloom/ui";
import {
  BookMarked,
  BookOpen,
  Edit3,
  EyeOff,
  FileDown,
  FileOutput,
  FilePlus2,
  FileStack,
  FileUp,
  FolderOpen,
  FormInput,
  GitCompare,
  Hash,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  LayoutTemplate,
  Lock,
  Maximize,
  Moon,
  PenTool,
  RotateCw,
  ScanText,
  Search,
  Shrink,
  Signature,
  Sparkles,
  Stamp,
  Sun,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLoomStore, type CompareTarget } from "./app/store";
import { PasswordPromptDialog } from "./components/PasswordPromptDialog";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { AccessibilityDialog } from "./features/ai/AccessibilityDialog";
import { ChatDialog } from "./features/ai/ChatDialog";
import { CommandBarDialog } from "./features/ai/CommandBarDialog";
import { ExplainSelectionToolbar } from "./features/ai/ExplainSelectionToolbar";
import { VoiceToFillButton } from "./features/forms/VoiceToFillButton";
import { SummarizeDialog } from "./features/ai/SummarizeDialog";
import { TranslateDialog } from "./features/ai/TranslateDialog";
import { AnnotateToolbar } from "./features/annotate/AnnotateToolbar";
import { SelectionMarkupToolbar } from "./features/annotate/SelectionMarkupToolbar";
import { CompareDialog } from "./features/compare/CompareDialog";
import { CompareView } from "./features/compare/CompareView";
import { CompressDialog } from "./features/convert/CompressDialog";
import { CreateFromTextDialog } from "./features/convert/CreateFromTextDialog";
import { ExportImagesDialog } from "./features/convert/ExportImagesDialog";
import { ExportOfficeDialog } from "./features/convert/ExportOfficeDialog";
import { OcrDialog } from "./features/convert/OcrDialog";
import { ProtectDialog } from "./features/protect/ProtectDialog";
import { RedactToolbar } from "./features/protect/RedactToolbar";
import { SignToolbar } from "./features/sign/SignToolbar";
import { useImageFilePicker } from "./features/convert/useImageFilePicker";
import { EditToolbar } from "./features/edit/EditToolbar";
import { FormsToolbar } from "./features/forms/FormsToolbar";
import { OrganizeView } from "./features/organize/OrganizeView";
import { QuickCreateDialog } from "./features/quick-create/QuickCreateDialog";
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
  const redactOpen = useLoomStore((s) => s.redactOpen);
  const setRedactOpen = useLoomStore((s) => s.setRedactOpen);
  const signOpen = useLoomStore((s) => s.signOpen);
  const setSignOpen = useLoomStore((s) => s.setSignOpen);
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
  const [compressOpen, setCompressOpen] = useState(false);
  const [createFromTextOpen, setCreateFromTextOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [exportOfficeOpen, setExportOfficeOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const compareTarget = useLoomStore((s) => s.compareTarget);
  const setCompareTarget = useLoomStore((s) => s.setCompareTarget);
  const [isInsertingImages, setIsInsertingImages] = useState(false);

  const handleComparePicked = (nextTarget: CompareTarget) => {
    setCompareTarget(nextTarget);
    setMainView("compare");
  };

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
                {
                  id: "mode-redact",
                  label: mainView === "read" && redactOpen ? "Exit redact mode" : "Redact…",
                  icon: <EyeOff />,
                  onSelect: () => {
                    setMainView("read");
                    setRedactOpen(!(mainView === "read" && redactOpen));
                  },
                },
                {
                  id: "mode-sign",
                  label: mainView === "read" && signOpen ? "Exit sign mode" : "Sign…",
                  icon: <Signature />,
                  onSelect: () => {
                    setMainView("read");
                    setSignOpen(!(mainView === "read" && signOpen));
                  },
                },
                { id: "watermark", label: "Add watermark…", icon: <PenTool />, onSelect: () => setWatermarkOpen(true) },
                { id: "header-footer", label: "Add header & footer…", icon: <FileStack />, onSelect: () => setHeaderFooterOpen(true) },
                { id: "page-numbers", label: "Page numbers & Bates…", icon: <Hash />, onSelect: () => setPageNumbersOpen(true) },
                { id: "insert-images", label: "Insert images as pages…", icon: <ImagePlus />, onSelect: () => imagePicker.open() },
                { id: "add-text", label: "Add pages from Markdown/HTML…", icon: <FilePlus2 />, onSelect: () => setCreateFromTextOpen(true) },
                { id: "export-images", label: "Export pages as images…", icon: <FileDown />, onSelect: () => setExportImagesOpen(true) },
                { id: "export-office", label: "Export to Word/Excel/PowerPoint…", icon: <FileOutput />, onSelect: () => setExportOfficeOpen(true) },
                { id: "ocr", label: "Make searchable (OCR)…", icon: <ScanText />, onSelect: () => setOcrOpen(true) },
                { id: "compress", label: "Compress…", icon: <Shrink />, onSelect: () => setCompressOpen(true) },
                { id: "protect", label: "Protect…", icon: <Lock />, onSelect: () => setProtectOpen(true) },
                {
                  id: "compare",
                  label: mainView === "compare" ? "Back to reading" : "Compare against another PDF…",
                  icon: <GitCompare />,
                  onSelect: () => (mainView === "compare" ? setMainView("read") : compareTarget ? setMainView("compare") : setCompareDialogOpen(true)),
                },
                { id: "summarize", label: "Summarize…", icon: <Sparkles />, tone: "ai", onSelect: () => setSummarizeOpen(true) },
                { id: "translate", label: "Translate…", icon: <Sparkles />, tone: "ai", onSelect: () => setTranslateOpen(true) },
                { id: "accessibility", label: "Image alt text…", icon: <Sparkles />, tone: "ai", onSelect: () => setAccessibilityOpen(true) },
                { id: "chat", label: "Chat with your PDF…", icon: <Sparkles />, tone: "ai", onSelect: () => setChatOpen(true) },
                { id: "command-bar", label: "AI command bar…", icon: <Sparkles />, tone: "ai", onSelect: () => setCommandBarOpen(true) },
                { id: "quick-create", label: "Quick Create…", icon: <LayoutTemplate />, tone: "ai", onSelect: () => setQuickCreateOpen(true) },
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
      redactOpen,
      setRedactOpen,
      signOpen,
      setSignOpen,
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
      setCompressOpen,
      setCreateFromTextOpen,
      setOcrOpen,
      setExportOfficeOpen,
      setProtectOpen,
      compareTarget,
      setCompareDialogOpen,
      setSummarizeOpen,
      setTranslateOpen,
      setAccessibilityOpen,
      setChatOpen,
      setCommandBarOpen,
      setQuickCreateOpen,
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
          <RailItem
            icon={<EyeOff />}
            label="Redact"
            active={mainView === "read" && redactOpen}
            onClick={() => {
              setMainView("read");
              setRedactOpen(!(mainView === "read" && redactOpen));
            }}
          />
          <RailItem
            icon={<Signature />}
            label="Sign"
            active={mainView === "read" && signOpen}
            onClick={() => {
              setMainView("read");
              setSignOpen(!(mainView === "read" && signOpen));
            }}
          />
          <RailItem icon={<Lock />} label="Protect" active={protectOpen} onClick={() => setProtectOpen(true)} />
          <RailItem
            icon={<GitCompare />}
            label="Compare"
            active={mainView === "compare"}
            onClick={() => (compareTarget ? setMainView("compare") : setCompareDialogOpen(true))}
          />
          <DropdownMenu
            align="start"
            trigger={<RailItem icon={<Sparkles />} label="AI tools" tone="ai" active={summarizeOpen || translateOpen || accessibilityOpen || chatOpen || commandBarOpen} />}
            items={[
              { id: "summarize", label: "Summarize…", icon: <Sparkles />, onSelect: () => setSummarizeOpen(true) },
              { id: "translate", label: "Translate…", icon: <Sparkles />, onSelect: () => setTranslateOpen(true) },
              { id: "accessibility", label: "Image alt text…", icon: <Sparkles />, onSelect: () => setAccessibilityOpen(true) },
              { id: "chat", label: "Chat with your PDF…", icon: <Sparkles />, onSelect: () => setChatOpen(true) },
              { id: "command-bar", label: "AI command bar…", icon: <Sparkles />, onSelect: () => setCommandBarOpen(true) },
            ]}
          />
          <RailItem icon={<LayoutTemplate />} label="Quick Create" tone="ai" active={quickCreateOpen} onClick={() => setQuickCreateOpen(true)} />
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
            trigger={
              <RailItem
                icon={<FileUp />}
                label="Convert"
                active={exportImagesOpen || compressOpen || createFromTextOpen || ocrOpen || exportOfficeOpen}
              />
            }
            items={[
              {
                id: "insert-images",
                label: isInsertingImages ? "Inserting…" : "Insert images as pages…",
                icon: <ImagePlus />,
                disabled: isInsertingImages,
                onSelect: () => imagePicker.open(),
              },
              { id: "add-text", label: "Add pages from Markdown/HTML…", icon: <FilePlus2 />, onSelect: () => setCreateFromTextOpen(true) },
              { id: "export-images", label: "Export pages as images…", icon: <FileDown />, onSelect: () => setExportImagesOpen(true) },
              { id: "export-office", label: "Export to Word/Excel/PowerPoint…", icon: <FileOutput />, onSelect: () => setExportOfficeOpen(true) },
              { id: "ocr", label: "Make searchable (OCR)…", icon: <ScanText />, onSelect: () => setOcrOpen(true) },
              { id: "compress", label: "Compress…", icon: <Shrink />, onSelect: () => setCompressOpen(true) },
            ]}
          />
        </Rail>
      )}
      {imagePicker.input}
      <main className="flex min-h-0 flex-1 flex-col">
        <h1 className="sr-only">PDFLoom</h1>
        {meta &&
          mainView === "read" &&
          (formFillOpen ? (
            <FormsToolbar />
          ) : annotateOpen ? (
            <AnnotateToolbar />
          ) : editOpen ? (
            <EditToolbar />
          ) : redactOpen ? (
            <RedactToolbar />
          ) : signOpen ? (
            <SignToolbar />
          ) : (
            <Toolbar />
          ))}
        <div className="flex min-h-0 flex-1">
          {meta &&
            mainView === "read" &&
            !annotateOpen &&
            !formFillOpen &&
            !editOpen &&
            !redactOpen &&
            !signOpen &&
            activePanel === "thumbnails" && <ThumbnailsPanel />}
          {meta &&
            mainView === "read" &&
            !annotateOpen &&
            !formFillOpen &&
            !editOpen &&
            !redactOpen &&
            !signOpen &&
            activePanel === "outline" && <OutlinePanel />}
          {meta &&
            mainView === "read" &&
            !annotateOpen &&
            !formFillOpen &&
            !editOpen &&
            !redactOpen &&
            !signOpen &&
            activePanel === "search" && <SearchPanel />}
          <div className="min-w-0 flex-1">
            {!meta ? (
              <WelcomeScreen />
            ) : mainView === "organize" ? (
              <OrganizeView />
            ) : mainView === "compare" && compareTarget ? (
              <CompareView
                target={compareTarget}
                onClose={() => setMainView("read")}
                onChooseDifferentFile={() => setCompareDialogOpen(true)}
              />
            ) : (
              <Viewer />
            )}
          </div>
        </div>
      </main>
      <CommandPalette groups={commandGroups} />
      <SelectionMarkupToolbar />
      <ExplainSelectionToolbar />
      <VoiceToFillButton />
      <PasswordPromptDialog />
      {meta && (
        <>
          <WatermarkDialog open={watermarkOpen} onOpenChange={setWatermarkOpen} />
          <HeaderFooterDialog open={headerFooterOpen} onOpenChange={setHeaderFooterOpen} />
          <PageNumbersDialog open={pageNumbersOpen} onOpenChange={setPageNumbersOpen} />
          <ExportImagesDialog open={exportImagesOpen} onOpenChange={setExportImagesOpen} />
          <CompressDialog open={compressOpen} onOpenChange={setCompressOpen} />
          <CreateFromTextDialog open={createFromTextOpen} onOpenChange={setCreateFromTextOpen} />
          <OcrDialog open={ocrOpen} onOpenChange={setOcrOpen} />
          <ExportOfficeDialog open={exportOfficeOpen} onOpenChange={setExportOfficeOpen} />
          <ProtectDialog open={protectOpen} onOpenChange={setProtectOpen} />
          <CompareDialog open={compareDialogOpen} onOpenChange={setCompareDialogOpen} onPicked={handleComparePicked} />
          <SummarizeDialog open={summarizeOpen} onOpenChange={setSummarizeOpen} />
          <TranslateDialog open={translateOpen} onOpenChange={setTranslateOpen} />
          <AccessibilityDialog open={accessibilityOpen} onOpenChange={setAccessibilityOpen} />
          <ChatDialog open={chatOpen} onOpenChange={setChatOpen} />
          <CommandBarDialog open={commandBarOpen} onOpenChange={setCommandBarOpen} />
          <QuickCreateDialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen} />
        </>
      )}
    </div>
  );
}
